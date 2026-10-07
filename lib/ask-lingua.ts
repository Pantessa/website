// lib/ask-lingua.ts — a stranger's first ask, read into the words the grammars
// know. PURE; the money-shape gate (lib/ask-failure-shape) and the intent net
// (lib/intent-rescue) both read through it, so a chip is still an English
// sentence the ladder builds.
//
// Found 2026-10-06 (squad pre-gtm, DEADENDS wave 2): "comprar bitcoin",
// "compra $10 de ETH", "kaufe ETH für 10$", "买10美元的ETH", "купить eth",
// "vender eth", "bitcoin kaufen" all fell to the planner, whose house model
// has no builders. The table below is deliberately small — the money verbs
// of the languages the tape's visitors actually wrote in — and maps a verb
// to its English family, never a token (tickers are already universal).

const VERBS: [RegExp, string][] = [
  // buy
  [/(?<!\p{L})(?:comprar|compra|compro|compre|cómprame|comprame|acheter|achète|achete|kaufe|kaufen|kauf|comprare|купить|купи|koop|kopen|köpa|kjøpe|купити)(?!\p{L})/giu, 'buy'],
  [/买|購入|買う|구매|사줘/gu, ' buy '],
  // sell
  [/(?<!\p{L})(?:vender|vende|vendo|vendre|vends|verkaufe|verkaufen|vendere|продать|продай|verkoop|sälja|selge)(?!\p{L})/giu, 'sell'],
  [/卖|売る|판매|팔아/gu, ' sell '],
  // swap / exchange
  [/(?<!\p{L})(?:cambiar|cambia|échanger|echanger|tauschen|tausche|scambiare|обменять|поменять|wisselen)(?!\p{L})/giu, 'swap'],
  [/兑换|交换/gu, ' swap '],
  // stake
  [/(?<!\p{L})(?:stakear|stakea|staker|staken|стейкать|застейкать)(?!\p{L})/giu, 'stake'],
  [/质押|ステーキング/gu, ' stake '],
  // send
  [/(?<!\p{L})(?:enviar|envía|envia|manda|mandar|envoyer|envoie|senden|schicke|schicken|inviare|отправить|отправь|sturen|verstuur)(?!\p{L})/giu, 'send'],
  [/发送|转账|送金/gu, ' send '],
  // earn
  [/(?<!\p{L})(?:ganar|gana|rendimiento|gagner|rendement|verdienen|rendite|guadagnare|заработать|доход)(?!\p{L})/giu, 'earn'],
  [/赚|收益|利息/gu, ' earn '],
  // long / short (the venue words are universal; the verbs are not)
  [/\b(?:largo|lungo|longue)\b/giu, 'long'],
  [/\b(?:corto|court|kurz)\b/giu, 'short'],
]

// Prepositions that sit where "of" / "to" / "for" / "on" sit.
const PREPS: [RegExp, string][] = [
  [/(?<!\p{L})(?:de|di|von|об)(?!\p{L})/giu, 'of'],
  [/(?<!\p{L})(?:für|fuer|por|pour|per|для)(?!\p{L})/giu, 'for'],
  [/(?<!\p{L})(?:en|sur|auf|su|на|op)(?!\p{L})/giu, 'on'],
  [/\b(?:a|à|zu|an|к|naar)\b(?=\s+(?:0x|[a-z0-9-]+\.eth\b))/giu, 'to'],
  [/的/gu, ' of '],
  // Politeness that carries no meaning.
  [/(?<!\p{L})(?:por\s+favor|s'il\s+vous\s+pla[iî]t|bitte|per\s+favore|пожалуйста|alsjeblieft|请)(?!\p{L})/giu, ''],
]

// Currency words in the amount slot: "10 美元", "10 dólares", "10 евро" → "$10".
const MONEY_WORDS = /(\d[\d,]*(?:\.\d+)?)\s*(?:美元|美金|dólares|dolares|dollars?|долларов|доллара|usd)\b/giu
const MONEY_WORDS_CJK = /(\d[\d,]*(?:\.\d+)?)\s*(?:美元|美金)/gu

/** True when the message carries a word the table knows (so the caller can
 *  tell "this was another language" apart from "this was English all along"). */
export function hasForeignMoneyWord(message: string): boolean {
  return VERBS.some(([re]) => {
    re.lastIndex = 0
    return re.test(message)
  })
}

/**
 * The message with its money verbs, prepositions and currency words read
 * into English. Idempotent on an English ask (every pattern is a non-English
 * word or a currency word already understood as "$").
 */
export function englishAsk(message: string): string {
  let m = message
  for (const [re, en] of VERBS) {
    re.lastIndex = 0
    m = m.replace(re, en)
  }
  // Only translate prepositions once a foreign verb or CJK word was present:
  // "de" is also a syllable of English ("de-risk") and "a" an English article.
  if (m !== message) for (const [re, en] of PREPS) {
    re.lastIndex = 0
    m = m.replace(re, en)
  }
  m = m.replace(MONEY_WORDS_CJK, '$$$1 ').replace(MONEY_WORDS, '$$$1')
  return m.replace(/\s+/g, ' ').trim()
}
