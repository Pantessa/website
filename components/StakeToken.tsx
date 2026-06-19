'use client'

// Stake / unstake / claim on a launched MCP token (x402-launch M6c). Stake the
// token into its YeetfulStaking vault to earn the maker-side rev share (USDC),
// claimable any time. Reads the connected wallet's balance / staked / earned via
// wagmi; writes approve → stake, unstake, and claim. Base Sepolia (LAUNCH_CHAIN).

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256, type Address } from 'viem'
import {
  ERC20_ABI,
  LAUNCH_CHAIN,
  STAKING_ABI,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
} from '@/lib/launch-contracts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const btn = {
  background: 'var(--accent)',
  color: 'var(--ink)',
  border: 'none',
  borderRadius: 12,
  padding: '8px 14px',
  fontWeight: 600,
  cursor: 'pointer',
} as const
const ghost = { ...btn, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--mist)' } as const
const note = { margin: 0, fontSize: 13, color: 'var(--smoke)' } as const
const fmt = (v: bigint | undefined, dec: number, max = 4) =>
  v === undefined ? '—' : Number(formatUnits(v, dec)).toLocaleString(undefined, { maximumFractionDigits: max })

export default function StakeToken({ token, staking }: { token: string; staking: string }) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<null | string>(null)
  const [error, setError] = useState<string | null>(null)

  const q = { enabled: !!address } as const
  const symbol = useReadContract({ address: token as Address, abi: ERC20_ABI, functionName: 'symbol', chainId: LAUNCH_CHAIN.id })
  const balance = useReadContract({ address: token as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address as Address], chainId: LAUNCH_CHAIN.id, query: q })
  const staked = useReadContract({ address: staking as Address, abi: STAKING_ABI, functionName: 'stakedOf', args: [address as Address], chainId: LAUNCH_CHAIN.id, query: q })
  const earned = useReadContract({ address: staking as Address, abi: STAKING_ABI, functionName: 'earned', args: [address as Address], chainId: LAUNCH_CHAIN.id, query: q })
  const allowance = useReadContract({ address: token as Address, abi: ERC20_ABI, functionName: 'allowance', args: [address as Address, staking as Address], chainId: LAUNCH_CHAIN.id, query: q })

  const refresh = useCallback(async () => {
    for (let i = 0; i < 4; i++) {
      await sleep(2500)
      void balance.refetch()
      void staked.refetch()
      void earned.refetch()
      void allowance.refetch()
    }
  }, [balance, staked, earned, allowance])

  const run = useCallback(
    async (kind: 'stake' | 'unstake' | 'claim') => {
      if (!address) return
      setError(null)
      try {
        await switchChainAsync({ chainId: LAUNCH_CHAIN.id }).catch(() => {})

        if (kind === 'claim') {
          setBusy('claim')
          await writeContractAsync({ address: staking as Address, abi: STAKING_ABI, functionName: 'claim', chainId: LAUNCH_CHAIN.id })
        } else {
          const amt = parseUnits((amount || '0').trim(), TOKEN_DECIMALS)
          if (amt <= BigInt(0)) throw new Error('Enter an amount.')
          if (kind === 'stake') {
            if ((allowance.data as bigint | undefined ?? BigInt(0)) < amt) {
              setBusy('approve')
              await writeContractAsync({ address: token as Address, abi: ERC20_ABI, functionName: 'approve', args: [staking as Address, maxUint256], chainId: LAUNCH_CHAIN.id })
            }
            setBusy('stake')
            await writeContractAsync({ address: staking as Address, abi: STAKING_ABI, functionName: 'stake', args: [amt], chainId: LAUNCH_CHAIN.id })
          } else {
            setBusy('unstake')
            await writeContractAsync({ address: staking as Address, abi: STAKING_ABI, functionName: 'unstake', args: [amt], chainId: LAUNCH_CHAIN.id })
          }
          setAmount('')
        }
        await refresh()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed.'
        setError(/rejected|denied|User /i.test(msg) ? 'Cancelled.' : msg.slice(0, 140))
      } finally {
        setBusy(null)
      }
    },
    [address, amount, allowance.data, staking, token, switchChainAsync, writeContractAsync, refresh],
  )

  if (!mounted) return null
  if (!isConnected) {
    return (
      <button style={btn} className="mono" onClick={() => openConnectModal?.()}>
        Connect wallet to stake
      </button>
    )
  }

  const earnedUsd = (earned.data as bigint | undefined) ?? BigInt(0)
  const canClaim = earnedUsd > BigInt(0)

  // Guard the doomed transactions: you stake the MCP TOKEN (not USDC — that's the
  // reward). If the wallet holds none, or you ask for more than you hold/staked,
  // the on-chain transferFrom reverts and the wallet shows a cryptic "not enough
  // funds / can't estimate fee". Catch it here and say what's actually wrong.
  const ticker = (symbol.data as string | undefined) || 'tokens'
  const bal = balance.data as bigint | undefined
  const stk = staked.data as bigint | undefined
  let amt = BigInt(0)
  try {
    amt = parseUnits((amount || '0').trim() || '0', TOKEN_DECIMALS)
  } catch {
    /* mid-typing (e.g. "0.") — treat as 0 */
  }
  const noBalance = bal !== undefined && bal === BigInt(0)
  const stakeTooMuch = amt > BigInt(0) && bal !== undefined && amt > bal
  const unstakeTooMuch = amt > BigInt(0) && stk !== undefined && amt > stk
  const stakeBlocked = !!busy || noBalance || stakeTooMuch
  const unstakeBlocked = !!busy || (stk !== undefined && stk === BigInt(0)) || unstakeTooMuch
  const hint = noBalance
    ? `You hold 0 ${ticker}. Stake the MCP token, not USDC — acquire ${ticker} from its pool first (USDC is what you earn).`
    : stakeTooMuch
      ? `Not enough ${ticker} — you hold ${fmt(bal, TOKEN_DECIMALS)}.`
      : unstakeTooMuch
        ? `You only have ${fmt(stk, TOKEN_DECIMALS)} ${ticker} staked.`
        : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 28px', fontSize: 14 }}>
        <span><span style={{ color: 'var(--smoke)' }}>your balance </span>{fmt(balance.data as bigint, TOKEN_DECIMALS)}</span>
        <span><span style={{ color: 'var(--smoke)' }}>you staked </span>{fmt(staked.data as bigint, TOKEN_DECIMALS)}</span>
        <span><span style={{ color: 'var(--smoke)' }}>claimable </span>${fmt(earnedUsd, USDC_DECIMALS, 4)}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder={`amount in ${ticker}`}
          inputMode="decimal"
          disabled={!!busy}
          className="mono"
          style={{ width: 150, minWidth: 0, border: '1px solid var(--mist)', borderRadius: 10, padding: '8px 11px', background: 'var(--paper)', color: 'var(--ink)' }}
        />
        <button style={btn} className="mono" disabled={stakeBlocked} onClick={() => void run('stake')}>
          {busy === 'approve' ? 'Approving…' : busy === 'stake' ? 'Staking…' : 'Stake'}
        </button>
        <button style={ghost} className="mono" disabled={unstakeBlocked} onClick={() => void run('unstake')}>
          {busy === 'unstake' ? 'Unstaking…' : 'Unstake'}
        </button>
        <button style={canClaim ? btn : ghost} className="mono" disabled={!!busy || !canClaim} onClick={() => void run('claim')}>
          {busy === 'claim' ? 'Claiming…' : 'Claim USDC'}
        </button>
      </div>
      {hint && !error && <p className="mono" style={note}>{hint}</p>}
      {error && <p className="mono" style={{ ...note, color: 'var(--error, #C0392B)' }}>{error}</p>}
    </div>
  )
}
