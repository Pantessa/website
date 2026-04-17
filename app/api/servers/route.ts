import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  try {
    const servers = await prisma.mcpServer.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })
    return NextResponse.json(servers)
  } catch (error) {
    console.error('Failed to fetch servers:', error)
    // Return empty array if DB not configured yet
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, description, iconUrl, category, websiteUrl, docsUrl, color, configSchema } = body

    if (!name || !description || !category) {
      return NextResponse.json(
        { error: 'name, description, and category are required' },
        { status: 400 }
      )
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    const server = await prisma.mcpServer.create({
      data: {
        name,
        slug: `${slug}-${Date.now()}`,
        description,
        iconUrl: iconUrl || null,
        category,
        websiteUrl: websiteUrl || null,
        docsUrl: docsUrl || null,
        color: color || '#555555',
        isDefault: false,
        isCustom: true,
        configSchema: configSchema || null,
      },
    })

    return NextResponse.json(server, { status: 201 })
  } catch (error) {
    console.error('Failed to create server:', error)
    return NextResponse.json({ error: 'Failed to create server' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    await prisma.mcpServer.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete server:', error)
    return NextResponse.json({ error: 'Failed to delete server' }, { status: 500 })
  }
}
