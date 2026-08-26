/**
 * Lightweight English inflection normalizer for conservative reuse detection.
 *
 * Scope: only handles inflectional morphology (tense, number, comparison).
 * Does NOT do synonym expansion or semantic merging — that belongs to intent
 * clustering, not phrase matching.
 *
 * Design goals:
 * - Deterministic, no external NLP dependency.
 * - Prefer false negatives (miss a variant) over false positives (wrong match).
 * - Irregular forms handled by an explicit lookup table; regular forms by rules.
 */

// Irregular verb principal parts. Maps non-base forms → base form.
// Covers common irregular verbs in technical/work English. No duplicate keys.
const IRREGULAR_VERBS: Record<string, string> = {
  // be
  was: "be", were: "be", been: "be", being: "be", am: "be", is: "be", are: "be",
  // have / do / go
  has: "have", had: "have", having: "have",
  does: "do", did: "do", done: "do", doing: "do",
  goes: "go", went: "go", gone: "go", going: "go",
  // common irregulars
  came: "come", coming: "come",
  saw: "see", seen: "see", seeing: "see",
  knew: "know", known: "know", knowing: "know",
  thought: "think", thinking: "think",
  made: "make", making: "make",
  took: "take", taken: "take", taking: "take",
  gave: "give", given: "give", giving: "give",
  said: "say", saying: "say",
  told: "tell", telling: "tell",
  got: "get", gotten: "get", getting: "get",
  found: "find", finding: "find",
  ran: "run", running: "run",
  sat: "sit", sitting: "sit",
  stood: "stand", standing: "stand",
  spoke: "speak", spoken: "speak", speaking: "speak",
  wrote: "write", written: "write", writing: "write",
  broke: "break", broken: "break", breaking: "break",
  chose: "choose", chosen: "choose", choosing: "choose",
  drove: "drive", driven: "drive", driving: "drive",
  ate: "eat", eaten: "eat", eating: "eat",
  fell: "fall", fallen: "fall", falling: "fall",
  flew: "fly", flown: "fly", flying: "fly",
  forgot: "forget", forgotten: "forget", forgetting: "forget",
  froze: "freeze", frozen: "freeze", freezing: "freeze",
  grew: "grow", grown: "grow", growing: "grow",
  heard: "hear", hearing: "hear",
  hid: "hide", hidden: "hide", hiding: "hide",
  hit: "hit", hitting: "hit",
  held: "hold", holding: "hold",
  kept: "keep", keeping: "keep",
  laid: "lay", laying: "lay",
  led: "lead", leading: "lead",
  left: "leave", leaving: "leave",
  lent: "lend", lending: "lend",
  let: "let", letting: "let",
  lay: "lie", lain: "lie", lying: "lie",
  lit: "light", lighted: "light", lighting: "light",
  lost: "lose", losing: "lose",
  meant: "mean", meaning: "mean",
  met: "meet", meeting: "meet",
  paid: "pay", paying: "pay",
  rode: "ride", ridden: "ride", riding: "ride",
  rang: "ring", rung: "ring", ringing: "ring",
  rose: "rise", risen: "rise", rising: "rise",
  sold: "sell", selling: "sell",
  sent: "send", sending: "send",
  set: "set", setting: "set",
  shook: "shake", shaken: "shake", shaking: "shake",
  shone: "shine", shined: "shine", shining: "shine",
  shot: "shoot", shooting: "shoot",
  showed: "show", shown: "show", showing: "show",
  shut: "shut", shutting: "shut",
  sang: "sing", sung: "sing", singing: "sing",
  sank: "sink", sunk: "sink", sinking: "sink",
  slept: "sleep", sleeping: "sleep",
  slid: "slide", sliding: "slide",
  spent: "spend", spending: "spend",
  spun: "spin", spinning: "spin",
  spread: "spread", spreading: "spread",
  sprang: "spring", sprung: "spring", springing: "spring",
  stole: "steal", stolen: "steal", stealing: "steal",
  stuck: "stick", sticking: "stick",
  stung: "sting", stinging: "sting",
  stank: "stink", stunk: "stink", stinking: "stink",
  struck: "strike", stricken: "strike", striking: "strike",
  swore: "swear", sworn: "swear", swearing: "swear",
  swept: "sweep", sweeping: "sweep",
  swam: "swim", swum: "swim", swimming: "swim",
  swung: "swing", swinging: "swing",
  taught: "teach", teaching: "teach",
  tore: "tear", torn: "tear", tearing: "tear",
  threw: "throw", thrown: "throw", throwing: "throw",
  understood: "understand", understanding: "understand",
  woke: "wake", woken: "wake", waking: "wake",
  wore: "wear", worn: "wear", wearing: "wear",
  won: "win", winning: "win",
  wound: "wind", winding: "wind",
  withdrew: "withdraw", withdrawn: "withdraw", withdrawing: "withdraw",
  // tech / work common
  built: "build", building: "build",
  bought: "buy", buying: "buy",
  caught: "catch", catching: "catch",
  dealt: "deal", dealing: "deal",
  dug: "dig", digging: "dig",
  drew: "draw", drawn: "draw", drawing: "draw",
  dreamt: "dream", dreamed: "dream", dreaming: "dream",
  fed: "feed", feeding: "feed",
  felt: "feel", feeling: "feel",
  fought: "fight", fighting: "fight",
  hung: "hang", hanged: "hang", hanging: "hang",
  knelt: "kneel", kneeling: "kneel",
  leant: "lean", leaned: "lean", leaning: "lean",
  leapt: "leap", leaped: "leap", leaping: "leap",
  learnt: "learn", learned: "learn", learning: "learn",
  proved: "prove", proven: "prove", proving: "prove",
  quit: "quit", quitting: "quit",
  read: "read", reading: "read",
  rid: "rid", ridding: "rid",
  sought: "seek", seeking: "seek",
  sewed: "sew", sewn: "sew", sewing: "sew",
  shaved: "shave", shaven: "shave", shaving: "shave",
  shrank: "shrink", shrunk: "shrink", shrinking: "shrink",
  smelled: "smell", smelt: "smell", smelling: "smell",
  sped: "speed", speeded: "speed", speeding: "speed",
  spilt: "spill", spilled: "spill", spilling: "spill",
  spat: "spit", spitting: "spit",
  split: "split", splitting: "split",
  strode: "stride", stridden: "stride", striding: "stride",
  strung: "string", stringing: "string",
  strove: "strive", striven: "strive", striving: "strive",
  swelled: "swell", swollen: "swell", swelling: "swell",
  thrived: "thrive", throve: "thrive", thriven: "thrive", thriving: "thrive",
  thrust: "thrust", thrusting: "thrust",
  trod: "tread", trodden: "tread", treading: "tread",
  undertook: "undertake", undertaken: "undertake", undertaking: "undertake",
  upset: "upset", upsetting: "upset",
  wove: "weave", woven: "weave", weaving: "weave",
  wept: "weep", weeping: "weep",
  withstood: "withstand", withstanding: "withstand",
  wrapped: "wrap", wrapping: "wrap",
  wrung: "wring", wringing: "wring",
};

// Irregular plurals → singular.
const IRREGULAR_PLURALS: Record<string, string> = {
  men: "man", women: "woman", children: "child", feet: "foot", teeth: "tooth",
  mice: "mouse", geese: "goose", people: "person", oxen: "ox", lice: "louse",
  cacti: "cactus", fungi: "fungus", nuclei: "nucleus", syllabi: "syllabus",
  analyses: "analysis", diagnoses: "diagnosis", crises: "crisis",
  criteria: "criterion", phenomena: "phenomenon", data: "datum",
  bacteria: "bacterium", media: "medium", spectra: "spectrum",
  indices: "index", matrices: "matrix", vertices: "vertex",
  axes: "axis", hypotheses: "hypothesis", theses: "thesis",
  databases: "database",
};

// Words that look like inflected forms but are base forms — never strip endings.
const NO_STRIP: Set<string> = new Set([
  // -ing that is base
  "thing", "morning", "evening", "ceiling", "meaning", "meeting", "building",
  "reading", "writing", "setting", "getting", "making", "taking",
  // -ed that is base
  "bed", "red", "led", "shed", "fed", "wed",
  // -er that is base (not comparative)
  "computer", "server", "user", "manager", "developer", "engineer",
  "number", "water", "after", "over", "under", "other", "another",
  "father", "mother", "brother", "sister", "daughter",
  "paper", "order", "power", "answer", "problem", "system",
  "customer", "partner", "member", "worker", "player",
  "folder", "border", "buffer", "cache", "cluster",
  // -es that is base
  "series", "species", "kudos",
  // -s that is base (singular)
  "this", "thus", "plus", "minus", "bus", "gas", "mass", "pass",
  "class", "glass", "boss", "cross", "loss", "process", "access",
  "success", "address", "business", "service", "practice", "notice",
  "office", "device", "advice", "choice", "voice", "house", "mouse",
  "phase", "phrase", "base", "case", "release",
]);

// Base words that inherently end in a doubled consonant. When we strip -ing/-ed
// and the stem ends in a doubled consonant, we only remove one consonant if the
// stem is NOT in this set — otherwise words like "roll" (→ rolling) would
// wrongly become "rol".
const INHERENT_DOUBLE: Set<string> = new Set([
  // -ll
  "roll", "call", "tell", "full", "fill", "pull", "bell", "hall", "tall",
  "small", "fall", "wall", "well", "ill", "bill", "hill", "kill", "mill",
  "pill", "till", "will", "chill", "drill", "grill", "skill", "still",
  "thrill", "shall", "doll", "poll", "scroll", "control", "enroll",
  "install", "recall", "stall", "sell", "spell", "smell", "dwell",
  "swell", "shell", "yell", "cell",
  // -ss
  "pass", "miss", "class", "glass", "cross", "boss", "mass", "less",
  "press", "dress", "address", "process", "access", "success", "business",
  "guess", "mess", "bless", "chess", "stress", "assess", "possess",
  // -ff
  "off", "stuff", "staff", "cliff", "stiff", "puff", "cuff", "huff",
  "ruff", "sniff", "whiff",
  // -zz
  "buzz", "fizz", "jazz", "dazzle",
  // -gg
  "egg", "wag", "dig", "fog", "log", "hug", "beg", "peg", "rag", "sag",
  "tag", "pig", "big", "fig", "jig", "rig", "twig", "zig",
  // -dd
  "add", "odd", "shed", "wed", "bed", "red", "fed", "led",
  // -bb
  "ebb", "rub", "crab", "grab", "stab", "blob", "glob", "snob", "slob",
  "bob", "cob", "job", "mob", "rob", "sob", "tab", "cab", "lab", "web",
]);

// Known -e drop verbs: stem after -ing/-ed → base form with e.
const E_DROP_VERBS: Record<string, string> = {
  mak: "make", tak: "take", giv: "give", com: "come", writ: "write",
  rid: "ride", hid: "hide", us: "use", mov: "move", hop: "hope",
  fac: "face", plac: "place", serv: "serve", clos: "close", rais: "raise",
  manag: "manage", chang: "change", sav: "save", liv: "live", lov: "love",
  driv: "drive", wav: "wave", shap: "shape", stat: "state", not: "note",
  pag: "page", siz: "size", cod: "code", nam: "name", dat: "date",
  grad: "grade", trad: "trade", slid: "slide", guid: "guide",
  decid: "decide", provid: "provide", divid: "divide", invit: "invite",
  refus: "refuse", remov: "remove", improv: "improve", achiev: "achieve",
  believ: "believe", receiv: "receive", perceiv: "perceive",
};

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const isDoubledConsonant = (stem: string): boolean =>
  stem.length >= 3 &&
  stem[stem.length - 1] === stem[stem.length - 2] &&
  !VOWELS.has(stem[stem.length - 1]!);

/**
 * Lemmatize a single lowercase word. Returns the base form.
 * Only handles inflection; never does derivation or synonym mapping.
 */
export const lemmatizeWord = (word: string): string => {
  if (word.length <= 2) return word;
  if (NO_STRIP.has(word)) return word;

  const irregular = IRREGULAR_VERBS[word];
  if (irregular) return irregular;

  const irregularPlural = IRREGULAR_PLURALS[word];
  if (irregularPlural) return irregularPlural;

  // -ing: strip, handle doubled consonant and -e drop
  if (word.endsWith("ing") && word.length > 4) {
    let stem = word.slice(0, -3);
    if (isDoubledConsonant(stem) && !INHERENT_DOUBLE.has(stem)) {
      stem = stem.slice(0, -1);
    }
    const eDrop = E_DROP_VERBS[stem];
    if (eDrop) return eDrop;
    return stem;
  }

  // -ed: strip, handle -ied, doubled consonant, and -e drop
  if (word.endsWith("ed") && word.length > 3) {
    let stem = word.slice(0, -2);
    if (stem.endsWith("i")) return stem.slice(0, -1) + "y";
    if (isDoubledConsonant(stem) && !INHERENT_DOUBLE.has(stem)) {
      stem = stem.slice(0, -1);
    }
    const eDrop = E_DROP_VERBS[stem];
    if (eDrop) return eDrop;
    return stem;
  }

  // -es / -s (third person singular or plural noun)
  if (word.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }
  if (word.endsWith("ses") || word.endsWith("zes") || word.endsWith("xes") ||
      word.endsWith("ches") || word.endsWith("shes")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("es") && word.length > 3) {
    return word.slice(0, -1);
  }
  if (word.endsWith("s") && word.length > 3 &&
      !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }

  // Comparatives / superlatives
  if (word.endsWith("est") && word.length > 4) {
    let stem = word.slice(0, -3);
    if (stem.endsWith("i")) return stem.slice(0, -1) + "y";
    if (isDoubledConsonant(stem) && !INHERENT_DOUBLE.has(stem)) {
      stem = stem.slice(0, -1);
    }
    return stem;
  }
  if (word.endsWith("er") && word.length > 3) {
    let stem = word.slice(0, -2);
    if (stem.endsWith("i")) return stem.slice(0, -1) + "y";
    if (isDoubledConsonant(stem) && !INHERENT_DOUBLE.has(stem)) {
      stem = stem.slice(0, -1);
    }
    return stem;
  }

  return word;
};

/**
 * Lemmatize a normalized (lowercase, punctuation-stripped) text phrase.
 * Splits on whitespace and lemmatizes each token.
 */
export const lemmatizeText = (text: string): string =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map(lemmatizeWord)
    .join(" ");

// --- Layer 2: function-word elastic matching ---

// Words that may be inserted, omitted, or replaced without changing the
// content of an expression. Preposition/adverbs that can be part of phrasal
// verbs (in, on, out, off, up, down, over, under) are deliberately excluded —
// "roll out" and "roll in" are different expressions.
const FUNCTION_WORDS: Set<string> = new Set([
  // articles
  "a", "an", "the",
  // pure prepositions (not phrasal-verb particles)
  "of", "to", "for", "with", "at", "by", "from", "as", "about", "between",
  "through", "during", "before", "after", "above", "below", "into", "onto",
  "upon", "against", "among", "around", "behind", "beside", "beyond",
  // conjunctions
  "and", "or", "but", "if", "because", "since", "while", "although",
  // pronouns
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
  "them", "my", "your", "his", "its", "our", "their", "this", "that",
  "these", "those", "what", "which", "who", "whom", "whose",
  // auxiliaries / copula
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "can", "could", "shall", "should",
  "may", "might", "must",
  // negation / emphasis / adverbs of time and place
  "not", "no", "yes", "also", "just", "only", "even", "still", "already",
  "yet", "ever", "never", "now", "then", "here", "there", "today",
  "tomorrow", "yesterday", "soon", "later", "always", "often", "sometimes",
  "usually", "really", "very", "too", "so", "thus", "therefore",
]);

const isContentWord = (word: string): boolean => !FUNCTION_WORDS.has(word);

const tokenize = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Normalize for matching: lowercase, strip punctuation, collapse whitespace. */
const normalizeForMatch = (text: string): string =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Elastic match: allow at most one function-word difference (insertion,
 * omission, or replacement) between the lemmatized needle and a window in
 * the lemmatized haystack. All content words must appear in order.
 *
 * Returns true if an elastic match exists. This is more permissive than
 * exact lemmatized match but still conservative — content words are strict.
 */
export const hasElasticMatch = (needle: string, haystack: string): boolean => {
  const nTokens = tokenize(needle);
  const hTokens = tokenize(haystack);
  if (nTokens.length === 0 || hTokens.length < nTokens.length - 1) return false;

  const nContent = nTokens.filter(isContentWord);
  if (nContent.length === 0) return false; // all-function-word needle: skip

  // Window spans from len(needle)-1 to len(needle)+1 tokens.
  // At most one function word may differ, so window size is bounded.
  const maxWindow = nTokens.length + 1;

  for (let start = 0; start <= hTokens.length - Math.max(1, nTokens.length - 1); start++) {
    const end = Math.min(start + maxWindow, hTokens.length);
    const window = hTokens.slice(start, end);
    if (window.length < nTokens.length - 1) continue;

    // All needle content words must appear in window in order.
    let ni = 0;
    for (let wi = 0; wi < window.length && ni < nContent.length; wi++) {
      if (window[wi] === nContent[ni]) ni++;
    }
    if (ni < nContent.length) continue;

    // Window must not contain content words outside the needle's content set.
    const extraContent = window.filter(
      (w) => isContentWord(w) && !nContent.includes(w)
    );
    if (extraContent.length > 0) continue;

    return true;
  }
  return false;
};

// --- Layer 3: candidate suggestions (user-confirmed, not auto-recorded) ---

export type ReuseCandidate = {
  expressionId: string;
  text: string;
  overlap: number; // 0..1 Jaccard on content words
  reason: "high_overlap";
};

/**
 * Find saved expressions that are similar to the text but did not match
 * via exact or elastic matching. Uses Jaccard similarity on content-word
 * sets. Returns candidates above the threshold — these should be shown to
 * the user for confirmation, never recorded automatically.
 */
export const findReuseCandidates = (
  text: string,
  expressions: ReadonlyArray<{ id: string; text: string }>,
  threshold = 0.6
): ReuseCandidate[] => {
  const hContent = new Set(
    tokenize(lemmatizeText(normalizeForMatch(text))).filter(isContentWord)
  );
  if (hContent.size === 0) return [];

  const candidates: ReuseCandidate[] = [];
  for (const expression of expressions) {
    const nContent = new Set(
      tokenize(lemmatizeText(normalizeForMatch(expression.text))).filter(isContentWord)
    );
    if (nContent.size === 0) continue;

    const intersection = [...nContent].filter((w) => hContent.has(w)).length;
    const union = new Set([...nContent, ...hContent]).size;
    const overlap = union === 0 ? 0 : intersection / union;

    if (overlap >= threshold && overlap < 1) {
      candidates.push({
        expressionId: expression.id,
        text: expression.text,
        overlap,
        reason: "high_overlap"
      });
    }
  }
  return candidates.sort((a, b) => b.overlap - a.overlap);
};
