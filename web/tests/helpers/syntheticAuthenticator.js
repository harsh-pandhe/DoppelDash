/** Synthetic software WebAuthn authenticator (ES256, 'none' attestation) shared by the passkey suites. */
const crypto = require('node:crypto')
const { isoBase64URL, isoCBOR } = require('@simplewebauthn/server/helpers')

// Synthetic software WebAuthn authenticator for standard ES256 credentials
function createSyntheticAuthenticator(rpID, defaultOrigin) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const coseKey = new Map([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, isoBase64URL.toBuffer(jwk.x)],
    [-3, isoBase64URL.toBuffer(jwk.y)],
  ])
  const credId = crypto.randomBytes(32)
  let counter = 0

  return {
    credId,
    credIdB64: isoBase64URL.fromBuffer(credId),
    createRegistrationResponse(challenge, origin = defaultOrigin, overrides = {}) {
      const targetRpId = overrides.rpID !== undefined ? overrides.rpID : rpID
      const rpIdHash = crypto.createHash('sha256').update(targetRpId).digest()
      const flags = Buffer.from([0x41]) // UP (0x01) + AT (0x40)
      const signCount = Buffer.alloc(4)
      const aaguid = Buffer.alloc(16)
      const credIdLen = Buffer.alloc(2)
      credIdLen.writeUInt16BE(credId.length, 0)
      const encodedCose = isoCBOR.encode(coseKey)
      const authData = Buffer.concat([rpIdHash, flags, signCount, aaguid, credIdLen, credId, encodedCose])
      const attestationObject = isoCBOR.encode(new Map([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]))
      const clientData = {
        type: 'webauthn.create',
        challenge: overrides.challenge !== undefined ? overrides.challenge : challenge,
        origin: overrides.origin !== undefined ? overrides.origin : origin,
        crossOrigin: false,
      }
      return {
        id: isoBase64URL.fromBuffer(credId),
        rawId: isoBase64URL.fromBuffer(credId),
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(Buffer.from(JSON.stringify(clientData))),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ['internal'],
        },
        type: 'public-key',
        clientExtensionResults: {},
      }
    },
    createAuthenticationResponse(challenge, origin = defaultOrigin, overrides = {}) {
      counter += 1
      const targetRpId = overrides.rpID !== undefined ? overrides.rpID : rpID
      const rpIdHash = crypto.createHash('sha256').update(targetRpId).digest()
      const authFlags = Buffer.from([0x01]) // UP
      const authSignCount = Buffer.alloc(4)
      authSignCount.writeUInt32BE(counter, 0)
      const authData = Buffer.concat([rpIdHash, authFlags, authSignCount])
      const clientData = {
        type: 'webauthn.get',
        challenge: overrides.challenge !== undefined ? overrides.challenge : challenge,
        origin: overrides.origin !== undefined ? overrides.origin : origin,
        crossOrigin: false,
      }
      const clientDataJSON = Buffer.from(JSON.stringify(clientData))
      const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest()
      const sigBase = Buffer.concat([authData, clientDataHash])
      const signer = crypto.createSign('SHA256')
      signer.update(sigBase)
      const signature = overrides.tamperSignature
        ? crypto.randomBytes(64)
        : signer.sign(privateKey)
      return {
        id: overrides.id || isoBase64URL.fromBuffer(credId),
        rawId: overrides.id || isoBase64URL.fromBuffer(credId),
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(signature),
        },
        type: 'public-key',
        clientExtensionResults: {},
      }
    },
  }
}

module.exports = { createSyntheticAuthenticator }
