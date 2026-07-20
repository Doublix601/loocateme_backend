import { getLocationStats } from '../services/businessStats.service.js';
import { statsToCsv } from '../services/businessStatsExport.service.js';

// Le funnel vue -> visite est réservé au palier pro3 (au-delà des stats de base
// débloquées dès pro2 par requireBusinessTier('pro2') sur la route).
function applyTierRestrictions(stats, businessTier) {
  if (businessTier === 'pro3') return stats;
  const { funnelConversionRate, ...rest } = stats;
  return { ...rest, funnelConversionRate: null };
}

export const BusinessStatsController = {
  get: async (req, res, next) => {
    try {
      const stats = await getLocationStats(req.location._id);
      return res.json(applyTierRestrictions(stats, req.location.businessTier));
    } catch (err) {
      next(err);
    }
  },

  exportCsv: async (req, res, next) => {
    try {
      const stats = await getLocationStats(req.location._id);
      const csv = statsToCsv(stats, req.location.name);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="stats-${req.location._id}.csv"`);
      return res.send(csv);
    } catch (err) {
      next(err);
    }
  },
};
