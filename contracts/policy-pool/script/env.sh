#!/usr/bin/env bash
# Export ONLY the keys the Foundry project needs from the website's .env.local, without printing them.
#   source contracts/policy-pool/script/env.sh            (from the website root)
#   source script/env.sh                                   (from contracts/policy-pool)
# Exports: ALCHEMY_API_KEY, BASE_RPC_URL (built from it), PRIVATE_KEY (the deployer), and, when present,
# POLICY_SIGNER_PRIVATE_KEY / POLICY_SIGNER_ADDRESS / POLICY_POOL_HOOK. Puts ~/.foundry/bin on PATH.
_pp_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../.." && pwd)"
_pp_env="${PP_ENV_FILE:-$_pp_root/.env.local}"
if [ ! -f "$_pp_env" ]; then echo "env.sh: no $_pp_env" >&2; return 1 2>/dev/null || exit 1; fi
_pp_get() { grep -E "^$1=" "$_pp_env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
export ALCHEMY_API_KEY="$(_pp_get ALCHEMY_API_KEY)"
export BASE_RPC_URL="https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
export BASE_SEPOLIA_RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
export PRIVATE_KEY="$(_pp_get PRIVATE_KEY)"
for _k in POLICY_SIGNER_PRIVATE_KEY POLICY_SIGNER_ADDRESS POLICY_POOL_HOOK; do
  _v="$(_pp_get "$_k")"; [ -n "$_v" ] && export "$_k=$_v"
done
export PATH="$HOME/.foundry/bin:$PATH"
unset _pp_root _pp_env _pp_get _k _v
echo "env.sh: exported ALCHEMY_API_KEY BASE_RPC_URL PRIVATE_KEY (+ POLICY_* when set); forge on PATH" >&2
