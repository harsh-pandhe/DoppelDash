/**
 * Helper to test client-side EntitlementRepository contract and cache lifecycle.
 */
class EntitlementRepository {
  constructor(dio) {
    this._dio = dio;
    this._current = null;
  }

  get current() {
    return this._current;
  }

  get isPremium() {
    return this._current?.plan === 'premium';
  }

  canUse(feature) {
    return Boolean(this._current?.features?.[feature]);
  }

  async fetchEntitlements() {
    const res = await this._dio.get('/billing/entitlements');
    this._current = res.data;
    return this._current;
  }

  clear() {
    this._current = null;
  }
}

module.exports = {
  EntitlementRepository,
};
