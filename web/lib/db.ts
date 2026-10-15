import mongoose from 'mongoose'
import { assertDataAccessAllowed } from '@/lib/deployContext'

const MONGODB_URI = process.env.MONGODB_URI!

if (!MONGODB_URI) throw new Error('MONGODB_URI is not defined')

declare global {
  // eslint-disable-next-line no-var
  var mongoose: { conn: typeof import('mongoose') | null; promise: Promise<typeof import('mongoose')> | null }
}

let cached = global.mongoose
if (!cached) cached = global.mongoose = { conn: null, promise: null }

export async function connectDB() {
  assertDataAccessAllowed()   // hosted deploys must declare DD_DEPLOY_CONTEXT=production|staging (previews fail closed)
  if (cached.conn) return cached.conn
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        // Serverless tuning — without these, cold invocations spend seconds
        // in "blocked"/"wait" doing connection + server selection per request.
        maxPoolSize: 10,
        minPoolSize: 0,
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 20000,
        connectTimeoutMS: 8000,
        maxIdleTimeMS: 60000,
        compressors: ['zlib'],
      })
      .then((m) => m)
      .catch((err) => {
        // Reset so the next request retries instead of reusing a rejected promise.
        cached.promise = null
        throw err
      })
  }
  cached.conn = await cached.promise
  return cached.conn
}
