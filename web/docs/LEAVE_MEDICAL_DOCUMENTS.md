# Leave medical documents — security note and contract (Phase 1J)

## Finding (confirmed in source and by `tests/leave_medical_docs.test.js` L2)
Before Phase 1J the Web leave form rendered `FileUploader` **without** a storage kind, so uploads defaulted to `kind=document`.
* `kind=document` tickets are *not* authenticated storage: the asset is stored and delivered under the provider's **public** delivery type
  (`…/image/upload/…`). Anyone who has the URL can read the file with no session — an unguessable URL is not access control.
* Document-kind uploads are **not** recorded in the `ReceiptUpload` manifest, so neither the abandoned-upload cleanup nor account deletion
  (`purgeOrgBlobs`, which walks the manifest) ever knew they existed.
* `POST /api/lms` stored `medicalDocs` as arbitrary strings (only "at least one for sick leave > 2 days" was checked); the API returned them
  as-is, so a public URL was handed to every reviewer and persisted in the database.
Implication: every medical document uploaded through the Web form before this change is **publicly deliverable** and **outside deletion/cleanup**.
Android did not have the feature, so it never created such files. Nothing in this repository inspects, alters or migrates production files.

## New contract (all new uploads)
1. `POST /api/uploads/sign { kind:'receipt', purpose:'leave_medical', mimeType, sizeBytes }` — authenticated; tenant folder; `type=authenticated`;
   format bound to the declared MIME type; plan size cap; manifest row with organisation, issuing user and purpose.
2. `POST /api/lms` accepts `medicalDocs` (≤ 10 values) **only for sick leave** (ignored for other types). Each value must be the authenticated-delivery
   URL of an upload this user was issued for `leave_medical` in this organisation, verified against the provider (private type, real format = declared
   format, size ≤ plan). External/public/cross-tenant/raw-reference/other-purpose/other-user values are refused. Files are claimed exclusively for
   the new leave (atomic) before it is written; a failed write releases only this request's claims.
3. The server stores the private `cld:` reference. Clients receive `/api/lms/<id>/document/<n>.<ext>` only.
4. `GET /api/lms/<id>/document/<n>` re-checks authorisation every time: anonymous 401; other organisation 404; an employee only for their own leave
   (403 otherwise); manager/admin of the same organisation for any leave of that organisation (same rule as `GET /api/lms/<id>`). Streamed server-side,
   `no-store`, PDFs as attachments.
5. Leave files cannot be attached as expense receipts or itinerary documents, and vice versa (purpose-checked at attach time on every path).
6. The abandoned-upload cleanup treats a leave's documents as references (never deleted); deleting a leave disposes of its files (provider first, manifest
   row removed only after confirmation, otherwise retried by the cleanup); disbanding an organisation purges them with the rest of the manifest.

## Legacy records — action still required
Old records keep plain public URLs. They are returned unchanged so they remain reviewable, they are **not private**, and the private endpoint answers
`404 legacy_attachment` for them. **A migration is required** (owner-run, with a dry run and a backup): for each `leaves.medicalDocs[i]` that is a public
URL of this organisation's `documents` folder, copy the asset into the authenticated receipts folder under a new manifest row (purpose `leave_medical`,
issuer = the leave's `userId`, state `attached`, `claimedBy` = the leave id), verify, rewrite the value to the `cld:` reference, then delete the public
asset. Until that is done and verified, do not describe legacy medical documents as private. No migration was attempted.

## Not verified
Real Cloudinary behaviour (authenticated delivery, signed private download, preset enforcement), physical-device behaviour, and production data.
