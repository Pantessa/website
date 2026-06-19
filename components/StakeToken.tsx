'use client'

// Stake / unstake / claim on a launched MCP token (x402-launch M6c). Stake the
// token into its YeetfulStaking vault to earn the maker-side rev share (USDC),
// claimable any time. Reads the connected wallet's balance / staked / earned via
// wagmi; writes approve → stake, unstake, and claim. Base Sepolia (LAUNCH_CHAIN).
//
// Presentation is an "earn" card matching the trade ticket: claimable USDC is the
// hero number (with its own Claim button), then a Stake/Unstake segmented control
// over a shared amount field with % chips.

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
const PCTS = [25, 50, 75, 100] as const
const fmt = (v: bigint | undefined, dec: number, max = 4) =>
  v === undefined ? '—' : Number(formatUnits(v, dec)).toLocaleString(undefined, { maximumFractionDigits: max })

export default function StakeToken({ token, staking }: { token: string; staking: string }) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [mode, setMode] = useState<'stake' | 'unstake'>('stake')
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
      <button className="tkt__cta mono" onClick={() => openConnectModal?.()}>
        Connect wallet to stake
      </button>
    )
  }

  const staking_ = mode === 'stake'
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
  const noStake = stk !== undefined && stk === BigInt(0)
  const ctaBlocked = staking_ ? (!!busy || noBalance || stakeTooMuch) : (!!busy || noStake || unstakeTooMuch)
  const chipsDisabled = !!busy || (staking_ ? (bal === undefined || bal === BigInt(0)) : (stk === undefined || stk === BigInt(0)))

  const onAmount = (v: string) => {
    const cleaned = v.replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')
    setAmount(parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned)
  }
  const setPct = (pct: number) => {
    const src = staking_ ? bal : stk
    if (src === undefined) return
    setAmount(formatUnits((src * BigInt(pct)) / BigInt(100), TOKEN_DECIMALS))
  }

  const hint = staking_
    ? noBalance
      ? `You hold 0 ${ticker}. Stake the MCP token, not USDC — acquire ${ticker} from its pool first (USDC is what you earn).`
      : stakeTooMuch
        ? `Not enough ${ticker} — you hold ${fmt(bal, TOKEN_DECIMALS)}.`
        : null
    : unstakeTooMuch
      ? `You only have ${fmt(stk, TOKEN_DECIMALS)} ${ticker} staked.`
      : null

  const ctaLabel =
    busy === 'approve' ? 'Approving…'
    : busy === 'stake' ? 'Staking…'
    : busy === 'unstake' ? 'Unstaking…'
    : staking_ ? 'Stake' : 'Unstake'

  return (
    <div className="tkt">
      {/* Claimable USDC — the payoff, front and centre. */}
      <div className="tkt__earn">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span className="tkt__earnlbl mono">claimable</span>
          <span className="tkt__earnval">${fmt(earnedUsd, USDC_DECIMALS, 4)}</span>
        </div>
        <button className="tkt__claim mono" disabled={!!busy || !canClaim} onClick={() => void run('claim')}>
          {busy === 'claim' ? 'Claiming…' : 'Claim USDC'}
        </button>
      </div>

      <div className="tkt__bal mono">
        <span className="tkt__ballbl">your {ticker}</span>
        <span className="tkt__balval">{fmt(bal, TOKEN_DECIMALS)}</span>
      </div>
      <div className="tkt__bal mono">
        <span className="tkt__ballbl">you staked</span>
        <span className="tkt__balval">{fmt(stk, TOKEN_DECIMALS)}</span>
      </div>

      <div className="tkt__tabs">
        <button className={`tkt__tab tkt__tab--buy mono${staking_ ? ' is-active' : ''}`} aria-pressed={staking_} disabled={!!busy} onClick={() => { setMode('stake'); setAmount(''); setError(null) }}>Stake</button>
        <button className={`tkt__tab tkt__tab--neutral mono${!staking_ ? ' is-active' : ''}`} aria-pressed={!staking_} disabled={!!busy} onClick={() => { setMode('unstake'); setAmount(''); setError(null) }}>Unstake</button>
      </div>

      <div className="tkt__field">
        <input
          className="tkt__input"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder={staking_ ? `${ticker} to stake` : `${ticker} to unstake`}
          inputMode="decimal"
          disabled={!!busy}
          aria-label={staking_ ? `${ticker} to stake` : `${ticker} to unstake`}
        />
        <span className="tkt__suffix mono">{ticker}</span>
      </div>

      <div className="tkt__chips">
        {PCTS.map((p) => (
          <button key={p} className="tkt__chip mono" disabled={chipsDisabled} onClick={() => setPct(p)}>
            {p === 100 ? 'Max' : `${p}%`}
          </button>
        ))}
      </div>

      <button className="tkt__cta mono" disabled={ctaBlocked || !amount} onClick={() => void run(mode)}>
        {ctaLabel}
      </button>

      {hint && !error && <p className="tkt__note mono">{hint}</p>}
      {error && <p className="tkt__msg tkt__msg--err mono">{error}</p>}
    </div>
  )
}
