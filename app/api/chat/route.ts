import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message, chatId, activeServerIds } = await req.json()

    // Build a system prompt that mentions the active MCP servers
    const serverContext =
      activeServerIds?.length > 0
        ? `You have the following MCP tools/servers available: ${activeServerIds.join(', ')}. Acknowledge what you can do with them.`
        : 'No MCP servers are currently active.'

    const systemPrompt = `You are Yeetful, a powerful AI assistant that can leverage MCP (Model Context Protocol) servers to perform real actions. ${serverContext}

When a user asks you to do something, clearly describe what MCP server you would use and what action you would take. Be concise and direct.`

    // Try Anthropic first, then OpenAI, then fallback
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const openaiKey = process.env.OPENAI_API_KEY

    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'No response from Claude.'
      return NextResponse.json({ reply })
    }

    if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          max_tokens: 1024,
        }),
      })
      const data = await res.json()
      const reply = data.choices?.[0]?.message?.content || 'No response from OpenAI.'
      return NextResponse.json({ reply })
    }

    // Demo fallback — no API key configured
    const demoReply = buildDemoReply(message, activeServerIds || [])
    return NextResponse.json({ reply: demoReply })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: 'Chat request failed' }, { status: 500 })
  }
}

function buildDemoReply(message: string, serverIds: string[]): string {
  if (serverIds.length === 0) {
    return `👋 I'm Yeetful! You haven't added any MCP servers yet.\n\nHead to the Servers page, pick some MCP servers, and come back to chat with them active.\n\nTo use real AI responses, set ANTHROPIC_API_KEY or OPENAI_API_KEY in your .env file.`
  }

  const serverList = serverIds.join(', ')
  return `🔌 **Demo Mode** (add an API key for real responses)\n\nYou asked: "${message}"\n\nWith servers [${serverList}] active, I would:\n\n• Analyze your request\n• Route it to the appropriate MCP server(s)\n• Execute the action and return results\n\nSet ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment to enable real AI responses.`
}
