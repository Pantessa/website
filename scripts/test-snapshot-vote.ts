// Unit checks for the Snapshot vote helpers (no network). Run: npx tsx scripts/test-snapshot-vote.ts
import {
  toSignable,
  voteRequestFromToolResult,
  voteRequestOf,
  friendlyVoteError,
  type VoteTypedData,
} from '../lib/snapshot-vote'
import { parseVoteIntent } from '../lib/vote-intent'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function tdOf(choiceType: string, choice: unknown): VoteTypedData {
  return {
    domain: { name: 'snapshot', version: '0.1.4' },
    types: {
      Vote: [
        { name: 'from', type: 'address' },
        { name: 'space', type: 'string' },
        { name: 'timestamp', type: 'uint64' },
        { name: 'proposal', type: 'bytes32' },
        { name: 'choice', type: choiceType },
        { name: 'reason', type: 'string' },
        { name: 'app', type: 'string' },
        { name: 'metadata', type: 'string' },
      ],
    },
    primaryType: 'Vote',
    message: {
      from: '0x1111111111111111111111111111111111111111',
      space: 'aave.eth',
      timestamp: 1_700_000_000,
      proposal: '0x' + 'a'.repeat(64),
      choice: choice as never,
      reason: '',
      app: 'yeetful',
      metadata: '{}',
    },
  }
}

console.log('toSignable — uint fields → BigInt:')
{
  const s = toSignable(tdOf('uint32', 2))
  check('timestamp → bigint', typeof s.message.timestamp === 'bigint' && s.message.timestamp === BigInt(1700000000))
  check('uint32 choice → bigint', s.message.choice === BigInt(2))
  check('string proposal stays string', s.message.proposal === '0x' + 'a'.repeat(64))
}
{
  const s = toSignable(tdOf('uint32[]', [1, 3]))
  const c = s.message.choice as bigint[]
  check('uint32[] choice → bigint[]', Array.isArray(c) && c[0] === BigInt(1) && c[1] === BigInt(3))
}
{
  const s = toSignable(tdOf('string', '{"1":1,"2":2}'))
  check('string choice stays string', s.message.choice === '{"1":1,"2":2}')
}

console.log('voteRequestFromToolResult:')
{
  const td = tdOf('uint32', 1)
  const valid = voteRequestFromToolResult({
    action: 'sign_vote',
    proposal: { id: td.message.proposal, title: 'Test', type: 'basic', choices: ['For', 'Against'], space: 'aave.eth' },
    choice: 1,
    choiceLabels: ['For'],
    summary: 'Vote on Test',
    typedData: td,
  })
  check('parses a valid sign_vote payload', valid !== null && valid.proposal.id === td.message.proposal)
  check('carries choiceLabels', valid?.choiceLabels?.[0] === 'For')
  check('rejects non-sign_vote', voteRequestFromToolResult({ foo: 'bar' }) === null)
  check('rejects missing typedData', voteRequestFromToolResult({ action: 'sign_vote', proposal: { id: '0x1' } }) === null)
}

console.log('voteRequestOf(meta):')
{
  const td = tdOf('uint32', 1)
  const vr = {
    proposal: { id: td.message.proposal, title: 'T', type: 'basic', choices: ['For'], space: 'x.eth' },
    choice: 1,
    summary: 's',
    typedData: td,
  }
  check('extracts voteRequest from meta', voteRequestOf({ voteRequest: vr }) !== null)
  check('null on receipts-only meta', voteRequestOf({ receipts: [] }) === null)
  check('null on undefined meta', voteRequestOf(undefined) === null)
}

console.log('parseVoteIntent:')
{
  const a = parseVoteIntent('vote For on the aave.eth proposal')
  check('detects vote + choice For', a.isVote && a.choiceText === 'for')
  check('captures space hint', a.spaceHint === 'aave.eth')

  const b = parseVoteIntent('cast my vote against 0x' + 'a'.repeat(64))
  check('detects against + proposal id', b.isVote && b.choiceText === 'against' && b.proposalId === '0x' + 'a'.repeat(64))

  const c = parseVoteIntent('vote option 2')
  check('parses option N', c.isVote && c.choiceText === 'option 2')

  const d = parseVoteIntent('vote yes')
  check('yes is a choice', d.isVote && d.choiceText === 'yes')

  const e = parseVoteIntent('I want to approve this')
  check('normalizes approve→approve (no verb → not a vote)', e.isVote === false)

  const f = parseVoteIntent('vote to approve it')
  check('vote to approve → approve', f.isVote && f.choiceText === 'approve')

  const g = parseVoteIntent('where do I vote?')
  check('bare vote verb is not an intent', g.isVote === false)

  const h = parseVoteIntent('what are the latest proposals?')
  check('non-vote message ignored', h.isVote === false)
}

console.log('friendlyVoteError:')
{
  check('no voting power', /no voting power/i.test(friendlyVoteError('failed; no voting power')))
  check('closed proposal', /closed/i.test(friendlyVoteError('Proposal is "closed", not active — voting is closed.')))
  check('already voted', /already voted/i.test(friendlyVoteError('oops: already voted')))
  check('expired timestamp', /expired/i.test(friendlyVoteError('vote timestamp too old')))
  check('bad signature', /sign again/i.test(friendlyVoteError('invalid signature, could not recover')))
  check('declined', /declined/i.test(friendlyVoteError(new Error('User rejected the request'))))
  check('not found', /couldn’t be found/i.test(friendlyVoteError('proposal not found')))
  check('unknown passes through (clipped)', friendlyVoteError('weird upstream blip') === 'weird upstream blip')
  check('empty → generic', friendlyVoteError('') === 'Voting failed.')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
