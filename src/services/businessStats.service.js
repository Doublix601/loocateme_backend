import mongoose from 'mongoose';
import { Event } from '../models/Event.js';

const MIN_SAMPLE_SIZE = 5; // anonymisation minimale : pas de stat démographique en dessous de ce seuil
const WEEKDAY_WINDOW_DAYS = 30;

// $dayOfWeek Mongo : 1=dimanche ... 7=samedi. On remappe vers 0=lundi ... 6=dimanche.
const MONGO_DOW_TO_MONDAY_FIRST = { 1: 6, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5 };

// Recalcule et dénormalise les stats de tous les lieux pro actifs dans
// Location.analytics (fallback d'affichage + évite de recalculer à chaque
// visite du dashboard). Appelé par le cron nocturne.
export async function recomputeAllLocationAnalytics() {
  const { Location } = await import('../models/Location.js');
  const locations = await Location.find({ businessTier: { $ne: 'none' } }).select('_id').lean();
  let updated = 0;
  for (const loc of locations) {
    try {
      const stats = await getLocationStats(loc._id);
      await Location.updateOne(
        { _id: loc._id },
        {
          'analytics.visitsByWeekday': stats.visitsByWeekday,
          'analytics.avgAgeVisitors': stats.avgAgeVisitors,
          'analytics.genderSplit': stats.genderSplit || { male: 0, female: 0, other: 0 },
          'analytics.ageGroups': stats.ageGroups || { '18-24': 0, '25-34': 0, '35-44': 0, '45+': 0 },
          'analytics.peakHours': stats.peakHours || [],
          'analytics.lastComputedAt': new Date(),
        }
      );
      updated += 1;
    } catch (e) {
      console.error(`[businessStats] Failed to recompute analytics for location ${loc._id}:`, e.message);
    }
  }
  return updated;
}

export async function getLocationStats(locationId) {
  const locObjectId = new mongoose.Types.ObjectId(String(locationId));
  const now = new Date();

  const windows = { '1d': 1, '7d': 7, '30d': 30 };
  const views = {};
  for (const [key, days] of Object.entries(windows)) {
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const previousSince = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000);
    const [current, previous] = await Promise.all([
      Event.countDocuments({ type: 'location_view', locationId: locObjectId, createdAt: { $gte: since, $lte: now } }),
      Event.countDocuments({ type: 'location_view', locationId: locObjectId, createdAt: { $gte: previousSince, $lt: since } }),
    ]);
    const deltaPct = previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
    views[key] = { current, previous, deltaPct };
  }

  const weekdaySince = new Date(now.getTime() - WEEKDAY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const hourlyAgg = await Event.aggregate([
    { $match: { type: 'location_visit', locationId: locObjectId, createdAt: { $gte: weekdaySince } } },
    { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
  ]);
  const hourlyDistribution = new Array(24).fill(0);
  for (const row of hourlyAgg) {
    if (row._id >= 0 && row._id < 24) hourlyDistribution[row._id] = row.count;
  }
  const peakHours = hourlyDistribution
    .map((count, hour) => ({ hour, count }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h) => h.hour)
    .sort((a, b) => a - b);
  const weekdayAgg = await Event.aggregate([
    { $match: { type: 'location_visit', locationId: locObjectId, createdAt: { $gte: weekdaySince } } },
    { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
  ]);
  const visitsByWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const row of weekdayAgg) {
    const idx = MONGO_DOW_TO_MONDAY_FIRST[row._id];
    if (idx !== undefined) visitsByWeekday[idx] = row.count;
  }

  const demographicsAgg = await Event.aggregate([
    {
      $match: {
        type: 'location_visit',
        locationId: locObjectId,
        actor: { $ne: null },
        createdAt: { $gte: weekdaySince },
      },
    },
    { $group: { _id: '$actor' } }, // un visiteur compté une fois sur la fenêtre
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $match: {
        'user.privacyPreferences.analytics': true,
      },
    },
    {
      $project: {
        gender: '$user.gender',
        ageYears: {
          $cond: [
            { $ifNull: ['$user.birthdate', false] },
            { $dateDiff: { startDate: '$user.birthdate', endDate: '$$NOW', unit: 'year' } },
            null,
          ],
        },
      },
    },
  ]);

  const ages = demographicsAgg.map((r) => r.ageYears).filter((a) => typeof a === 'number' && a > 0 && a < 120);
  const genderCounts = { male: 0, female: 0, other: 0 };
  for (const r of demographicsAgg) {
    if (r.gender === 'male') genderCounts.male += 1;
    else if (r.gender === 'female') genderCounts.female += 1;
    else if (r.gender === 'other' || r.gender === 'prefer_not_to_say') genderCounts.other += 1;
  }
  const genderSampleSize = genderCounts.male + genderCounts.female + genderCounts.other;
  const sampleSize = demographicsAgg.length;

  const avgAgeVisitors = ages.length >= MIN_SAMPLE_SIZE
    ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10
    : null;

  const genderSplit = genderSampleSize >= MIN_SAMPLE_SIZE
    ? {
        male: Math.round((genderCounts.male / genderSampleSize) * 100) / 100,
        female: Math.round((genderCounts.female / genderSampleSize) * 100) / 100,
        other: Math.round((genderCounts.other / genderSampleSize) * 100) / 100,
      }
    : null;

  const ageBucketCounts = { '18-24': 0, '25-34': 0, '35-44': 0, '45+': 0 };
  for (const age of ages) {
    if (age >= 18 && age <= 24) ageBucketCounts['18-24'] += 1;
    else if (age >= 25 && age <= 34) ageBucketCounts['25-34'] += 1;
    else if (age >= 35 && age <= 44) ageBucketCounts['35-44'] += 1;
    else if (age >= 45) ageBucketCounts['45+'] += 1;
  }
  const ageGroups = ages.length >= MIN_SAMPLE_SIZE ? ageBucketCounts : null;

  const [funnelViews, funnelVisits] = await Promise.all([
    Event.countDocuments({ type: 'location_view', locationId: locObjectId, createdAt: { $gte: weekdaySince } }),
    Event.countDocuments({ type: 'location_visit', locationId: locObjectId, createdAt: { $gte: weekdaySince } }),
  ]);
  const funnelConversionRate = funnelViews >= MIN_SAMPLE_SIZE
    ? Math.round((funnelVisits / funnelViews) * 1000) / 10
    : null;

  return {
    views,
    visitsByWeekday,
    avgAgeVisitors,
    genderSplit,
    ageGroups,
    peakHours,
    hourlyDistribution,
    funnelConversionRate,
    sampleSize,
  };
}
