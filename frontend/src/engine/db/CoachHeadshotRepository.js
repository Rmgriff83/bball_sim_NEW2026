import { PersonnelHeadshotRepository } from './PersonnelHeadshotRepository'

// Back-compat alias for the original coach-only API. As of v5 the
// underlying store is `personnelHeadshots` keyed by [campaignId, kind, id];
// the coach-keyed signature here is a thin pass-through with kind='coach'.
// Existing call sites (CoachAvatar, HeadshotEditorView's coach save path)
// keep working unchanged.

export const CoachHeadshotRepository = {
  async get(campaignId, coachId) {
    return PersonnelHeadshotRepository.get(campaignId, 'coach', coachId)
  },
  async save(campaignId, coachId, svgContent) {
    return PersonnelHeadshotRepository.save(campaignId, 'coach', coachId, svgContent)
  },
  async delete(campaignId, coachId) {
    return PersonnelHeadshotRepository.delete(campaignId, 'coach', coachId)
  },
  async getAllByCampaign(campaignId) {
    return PersonnelHeadshotRepository.getAllByKind(campaignId, 'coach')
  },
  async deleteAllForCampaign(campaignId) {
    return PersonnelHeadshotRepository.deleteAllForCampaign(campaignId)
  },
}
