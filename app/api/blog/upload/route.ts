import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { getAdminAddress } from '@/lib/blog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024 // 8MB — blog photos, not RAW files
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

// Upload a blog image to Vercel Blob; returns its public URL for use as a
// coverImageUrl or an inline markdown image. Admin only (SIWE or Bearer key).
// Auth is checked before configuration so non-admins learn nothing about the
// deployment's Blob setup.
export async function POST(req: NextRequest) {
  const admin = await getAdminAddress(req)
  if (!admin) return NextResponse.json({ error: 'Not an admin.' }, { status: 403 })

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Uploads are disabled: create a Blob store in Vercel and set BLOB_READ_WRITE_TOKEN.' },
      { status: 503 },
    )
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "multipart form field 'file' is required." }, { status: 400 })
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `unsupported type ${file.type || '?'} — jpeg/png/webp/gif/avif only.` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file is ${(file.size / 1e6).toFixed(1)}MB — max 8MB.` }, { status: 400 })
  }

  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 80) || 'image'
  const blob = await put(`blog/${safeName}`, file, {
    access: 'public',
    addRandomSuffix: true, // no overwrites, unguessable final URL
  })
  return NextResponse.json({ url: blob.url }, { status: 201 })
}
