import fs from 'fs';
import { BusinessClaimRequest } from '../models/BusinessClaimRequest.js';
import { createClaimRequest, actOnClaimRequest } from '../services/businessClaim.service.js';
import { businessDocAbsolutePath } from '../services/storage.service.js';

const MAX_PAGE_LIMIT = 100;

const FIELD_TO_DOC_TYPE = { kbis: 'KBIS', id: 'ID', leaseProof: 'LEASE_PROOF' };

export const BusinessClaimController = {
  create: async (req, res, next) => {
    try {
      const { locationId, applicantEmail, applicantName, applicantPhone } = req.body || {};
      if (!locationId) return res.status(400).json({ code: 'LOCATION_ID_REQUIRED', message: 'locationId requis' });
      if (!applicantEmail || !applicantName) {
        return res.status(400).json({ code: 'APPLICANT_INFO_REQUIRED', message: 'Nom et email du candidat requis' });
      }
      const files = req.files || {};
      if (!files.kbis?.length || !files.id?.length) {
        return res.status(400).json({ code: 'DOCUMENTS_REQUIRED', message: 'Extrait Kbis et pièce d\'identité requis' });
      }
      const documents = [];
      for (const [field, docType] of Object.entries(FIELD_TO_DOC_TYPE)) {
        for (const file of files[field] || []) {
          documents.push({ type: docType, url: file.filename });
        }
      }

      const claim = await createClaimRequest({ locationId, applicantEmail, applicantName, applicantPhone, documents });
      return res.status(201).json({ claimId: claim._id });
    } catch (err) {
      next(err);
    }
  },

  status: async (req, res, next) => {
    try {
      const claim = await BusinessClaimRequest.findById(req.params.id).select('status rejectionReason createdAt').lean();
      if (!claim) return res.status(404).json({ code: 'CLAIM_NOT_FOUND', message: 'Candidature introuvable' });
      return res.json({ status: claim.status, rejectionReason: claim.rejectionReason || '', createdAt: claim.createdAt });
    } catch (err) {
      next(err);
    }
  },

  list: async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;
      const status = String(req.query.status || 'pending');
      const query = status === 'all' ? {} : { status };

      const [items, total] = await Promise.all([
        BusinessClaimRequest.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('locationId', 'name city type')
          .lean(),
        BusinessClaimRequest.countDocuments(query),
      ]);

      return res.json({ page, limit, total, items });
    } catch (err) {
      next(err);
    }
  },

  document: async (req, res, next) => {
    try {
      const claim = await BusinessClaimRequest.findById(req.params.id).lean();
      if (!claim) return res.status(404).json({ code: 'CLAIM_NOT_FOUND', message: 'Candidature introuvable' });
      const docIndex = parseInt(req.params.docIndex, 10);
      const doc = claim.documents?.[docIndex];
      if (!doc) return res.status(404).json({ code: 'DOCUMENT_NOT_FOUND', message: 'Document introuvable' });
      const absPath = businessDocAbsolutePath(doc.url);
      if (!fs.existsSync(absPath)) return res.status(404).json({ code: 'FILE_NOT_FOUND', message: 'Fichier introuvable' });
      return res.sendFile(absPath);
    } catch (err) {
      next(err);
    }
  },

  action: async (req, res, next) => {
    try {
      const { action, rejectionReason } = req.body || {};
      const claim = await actOnClaimRequest(req.params.id, { action, rejectionReason, moderatorId: req.user?.id });
      return res.json({ success: true, claimId: claim._id, status: claim.status });
    } catch (err) {
      next(err);
    }
  },
};
