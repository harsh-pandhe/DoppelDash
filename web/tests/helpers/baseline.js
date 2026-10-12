/**
 * Fixture-scoped residue checks.
 *
 * "Zero test artifacts remain" must mean "nothing THIS suite created is left behind" — not "the database holds no
 * non-Doppelmayr data at all", which depends on whatever else lives in the (throwaway) database, e.g. the organisation
 * the dev seed creates. A suite snapshots the foreign (non-Doppelmayr) document ids that exist BEFORE it runs; the
 * residue filters then exclude exactly those ids. Anything the suite itself created and failed to remove still fails.
 */
const COLLECTIONS = ['organizations', 'orgsettings', 'users', 'employees', 'invitations', 'contacts', 'leavebalances']

async function captureForeignBaseline(db) {
  const ids = {}
  for (const c of COLLECTIONS) {
    ids[c] = (await db.collection(c).find({ orgId: { $ne: 'org_doppelmayr' } }, { projection: { _id: 1 } }).toArray()).map(d => d._id)
  }
  return {
    ids,
    /** Query fragment: documents of `collection` that were NOT present when the baseline was captured. */
    created: collection => ({ _id: { $nin: ids[collection] || [] } }),
  }
}
module.exports = { captureForeignBaseline }
