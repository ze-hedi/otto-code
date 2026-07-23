// src/oss/src/utils/lemmatization.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "can't",
  "cannot",
  "could",
  "couldn't",
  "did",
  "didn't",
  "do",
  "does",
  "doesn't",
  "doing",
  "don't",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "get",
  "got",
  "had",
  "hadn't",
  "has",
  "hasn't",
  "have",
  "haven't",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "itself",
  "just",
  "let's",
  "me",
  "might",
  "more",
  "most",
  "mustn't",
  "must",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "shall",
  "shan't",
  "she",
  "should",
  "shouldn't",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "wasn't",
  "we",
  "were",
  "weren't",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "won't",
  "would",
  "wouldn't",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves"
]);
var _porterStemmer;
function getPorterStemmer() {
  if (_porterStemmer !== void 0) {
    return _porterStemmer;
  }
  try {
    const natural = require("natural");
    _porterStemmer = natural.PorterStemmer;
    return _porterStemmer;
  } catch (e) {
    _porterStemmer = null;
    return null;
  }
}
function simpleStem(word) {
  if (word.length <= 3) {
    return word;
  }
  let w = word;
  if (w.endsWith("ies") && w.length > 4) {
    w = w.slice(0, -3) + "i";
  } else if (w.endsWith("sses")) {
    w = w.slice(0, -2);
  } else if (w.endsWith("ness")) {
    w = w.slice(0, -4);
  } else if (w.endsWith("ment") && w.length > 5) {
    w = w.slice(0, -4);
  } else if (w.endsWith("ation") && w.length > 6) {
    w = w.slice(0, -5) + "e";
  } else if (w.endsWith("ting") && w.length > 5) {
    w = w.slice(0, -3);
  } else if (w.endsWith("ing") && w.length > 5) {
    w = w.slice(0, -3);
  } else if (w.endsWith("ed") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("ly") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("er") && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith("est") && w.length > 4) {
    w = w.slice(0, -3);
  } else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
    w = w.slice(0, -1);
  }
  return w;
}
function lemmatizeForBm25(text) {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g);
  if (!words) {
    return text.toLowerCase();
  }
  const stemmer = getPorterStemmer();
  const stemFn = stemmer ? (w) => stemmer.stem(w).toLowerCase() : simpleStem;
  const tokens = [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) {
      continue;
    }
    const stemmed = stemFn(word);
    if (stemmed && /^[a-z0-9]+$/.test(stemmed)) {
      tokens.push(stemmed);
    }
    if (word.endsWith("ing") && word !== stemmed && /^[a-z0-9]+$/.test(word)) {
      tokens.push(word);
    }
  }
  return tokens.join(" ");
}

// src/oss/src/utils/entity_extraction.ts
var GENERIC_HEADS = /* @__PURE__ */ new Set([
  "thing",
  "stuff",
  "way",
  "time",
  "experience",
  "situation",
  "case",
  "fact",
  "matter",
  "issue",
  "idea",
  "thought",
  "feeling",
  "place",
  "area",
  "part",
  "kind",
  "type",
  "sort",
  "lot",
  "bit",
  "day",
  "year",
  "week",
  "month",
  "moment",
  "instance",
  "example",
  "technique",
  "method",
  "approach",
  "process",
  "step",
  "tool",
  "result",
  "outcome",
  "goal",
  "task",
  "item",
  "topic",
  "scale",
  "size",
  "level",
  "degree",
  "amount",
  "number",
  "style",
  "look",
  "color",
  "colour",
  "shape",
  "form",
  "piece",
  "section",
  "side",
  "end",
  "edge",
  "surface",
  "point"
]);
var NON_SPECIFIC_ADJ = /* @__PURE__ */ new Set([
  "many",
  "few",
  "several",
  "some",
  "any",
  "all",
  "most",
  "more",
  "less",
  "much",
  "little",
  "enough",
  "various",
  "numerous",
  "multiple",
  "countless",
  "great",
  "good",
  "bad",
  "nice",
  "terrible",
  "awful",
  "awesome",
  "amazing",
  "wonderful",
  "horrible",
  "excellent",
  "poor",
  "best",
  "worst",
  "fine",
  "okay",
  "new",
  "old",
  "recent",
  "past",
  "future",
  "current",
  "previous",
  "next",
  "last",
  "first",
  "latest",
  "early",
  "late",
  "former",
  "modern",
  "ancient",
  "big",
  "small",
  "large",
  "tiny",
  "huge",
  "enormous",
  "long",
  "short",
  "tall",
  "high",
  "low",
  "wide",
  "narrow",
  "thick",
  "thin",
  "deep",
  "shallow",
  "similar",
  "different",
  "same",
  "other",
  "another",
  "such",
  "certain",
  "important",
  "main",
  "major",
  "minor",
  "key",
  "primary",
  "real",
  "actual",
  "true",
  "whole",
  "entire",
  "full",
  "complete",
  "total",
  "basic",
  "simple",
  "interesting",
  "boring",
  "exciting",
  "special",
  "particular",
  "general",
  "common",
  "unique",
  "rare",
  "typical",
  "usual",
  "normal",
  "regular",
  "possible",
  "likely",
  "potential",
  "available",
  "necessary",
  "only",
  "solo",
  "individual",
  "team",
  "group",
  "joint",
  "collaborative",
  "final",
  "initial",
  "side"
]);
var GENERIC_ENDINGS = /* @__PURE__ */ new Set([
  "work",
  "works",
  "job",
  "jobs",
  "task",
  "tasks",
  "stuff",
  "things",
  "thing",
  "info",
  "information",
  "details",
  "data",
  "content",
  "material",
  "materials",
  "activities",
  "activity",
  "efforts",
  "effort",
  "options",
  "option",
  "choices",
  "choice",
  "results",
  "result",
  "output",
  "outputs",
  "products",
  "product",
  "items",
  "item"
]);
var GENERIC_CAPS = /* @__PURE__ */ new Set([
  "works",
  "items",
  "things",
  "stuff",
  "resources",
  "options",
  "tips",
  "ideas",
  "steps",
  "ways",
  "methods",
  "tools",
  "features",
  "benefits",
  "examples",
  "details",
  "notes",
  "instructions",
  "guidelines",
  "recommendations",
  "suggestions",
  "overview",
  "summary",
  "conclusion",
  "introduction",
  "pros",
  "cons",
  "advantages",
  "disadvantages"
]);
var FORMATTING_MARKERS = /* @__PURE__ */ new Set([
  "*",
  "-",
  "+",
  "\u2022",
  "\u2013",
  "\u2014",
  "#",
  "##",
  "###",
  "**",
  "__"
]);
var nlp;
try {
  nlp = require("compromise");
} catch (e) {
}
function hasArtifacts(txt) {
  if (txt.includes("**") || txt.includes("__") || txt.includes(":*")) {
    return true;
  }
  if (/\s\*\s|\s\*$|^\*\s/.test(txt)) {
    return true;
  }
  if (txt.includes("  ") || txt.includes("\n") || txt.includes("\t")) {
    return true;
  }
  if (txt.length > 100) {
    return true;
  }
  if (/^[\u2022\-+\u2013\u2014]/.test(txt)) {
    return true;
  }
  return false;
}
function stripGenericEnding(words) {
  if (words.length <= 1) {
    return words;
  }
  const last = words[words.length - 1].toLowerCase();
  if (GENERIC_ENDINGS.has(last) && words.length > 2) {
    return words.slice(0, -1);
  }
  return words;
}
function isSentenceStart(tokens, idx, rawText) {
  if (idx === 0) {
    return true;
  }
  const prev = tokens[idx - 1];
  if (/[.!?:]$/.test(prev)) {
    return true;
  }
  if (FORMATTING_MARKERS.has(prev)) {
    return true;
  }
  const tokenStart = rawText.indexOf(tokens[idx]);
  if (tokenStart > 0 && rawText.charAt(tokenStart - 1) === "\n") {
    return true;
  }
  return false;
}
function extractQuoted(text) {
  const entities = [];
  const doubleQuoteRe = /"([^"]+)"/g;
  let match;
  while ((match = doubleQuoteRe.exec(text)) !== null) {
    const inner = match[1].trim();
    if (inner.length > 2) {
      entities.push({ type: "QUOTED", text: inner });
    }
  }
  const singleQuoteRe = /(?:^|[\s([{,;])'([^']+)'(?=[\s.,;:!?)\]]|$)/g;
  while ((match = singleQuoteRe.exec(text)) !== null) {
    const inner = match[1].trim();
    if (inner.length > 2) {
      entities.push({ type: "QUOTED", text: inner });
    }
  }
  return entities;
}
function extractProper(text) {
  const entities = [];
  const tokens = text.split(/\s+/).filter(Boolean);
  const functionWords = /* @__PURE__ */ new Set([
    "'s",
    "of",
    "the",
    "in",
    "and",
    "for",
    "at",
    "is"
  ]);
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (FORMATTING_MARKERS.has(tok)) {
      i++;
      continue;
    }
    const isLabel = i + 1 < tokens.length && tokens[i + 1] === ":";
    const isCap = tok.length > 0 && tok.charAt(0) === tok.charAt(0).toUpperCase() && /[A-Z]/.test(tok.charAt(0));
    if (isCap && !isLabel) {
      const seq = [
        { token: tok, idx: i }
      ];
      let j = i + 1;
      while (j < tokens.length) {
        const t = tokens[j];
        const tIsCap = t.length > 0 && t.charAt(0) === t.charAt(0).toUpperCase() && /[A-Z]/.test(t.charAt(0));
        if (tIsCap || functionWords.has(t.toLowerCase())) {
          seq.push({ token: t, idx: j });
          j++;
        } else {
          break;
        }
      }
      while (seq.length > 0 && functionWords.has(seq[seq.length - 1].token.toLowerCase())) {
        seq.pop();
      }
      if (seq.length > 0) {
        const hasMidCap = seq.some(({ token, idx: tokenIdx }) => {
          const isCapWord = /[A-Z]/.test(token.charAt(0)) && !functionWords.has(token.toLowerCase());
          return isCapWord && !isSentenceStart(tokens, tokenIdx, text);
        });
        if (hasMidCap) {
          const phrase = seq.map((s) => s.token).join(" ");
          if (phrase.length > 2) {
            entities.push({ type: "PROPER", text: phrase });
          }
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return entities;
}
function extractCompoundsWithNlp(text) {
  if (!nlp) {
    return [];
  }
  const entities = [];
  const doc = nlp(text);
  const nouns = doc.nouns().out("array");
  for (const nounPhrase of nouns) {
    const trimmed = nounPhrase.trim();
    if (!trimmed || trimmed.length <= 3) {
      continue;
    }
    const words = trimmed.split(/\s+/);
    if (words.length < 2) {
      continue;
    }
    const head = words[words.length - 1].toLowerCase();
    if (GENERIC_HEADS.has(head)) {
      const hasSpecificMod = words.some(
        (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase()) && w !== words[words.length - 1]
      );
      if (!hasSpecificMod) {
        continue;
      }
    }
    const filtered = words.filter(
      (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase())
    );
    const cleaned = stripGenericEnding(filtered);
    if (cleaned.length >= 2) {
      const phrase = cleaned.join(" ");
      if (phrase.length > 3) {
        entities.push({ type: "COMPOUND", text: phrase });
      }
    }
  }
  return entities;
}
function extractCompoundsRegex(text) {
  const entities = [];
  const compoundRe = /\b([A-Z][a-z]+(?:\s+(?:of|and|the|for|in)\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let match;
  while ((match = compoundRe.exec(text)) !== null) {
    const phrase = match[1].trim();
    if (phrase.length > 3 && phrase.includes(" ")) {
      const words = phrase.split(/\s+/);
      const head = words[words.length - 1].toLowerCase();
      if (!GENERIC_HEADS.has(head)) {
        const filtered = words.filter(
          (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase())
        );
        const cleaned = stripGenericEnding(filtered);
        if (cleaned.length >= 2) {
          entities.push({ type: "COMPOUND", text: cleaned.join(" ") });
        }
      }
    }
  }
  const lowerCompoundRe = /\b([a-z]+(?:\s+[a-z]+){1,3})\b/g;
  while ((match = lowerCompoundRe.exec(text)) !== null) {
    const phrase = match[1].trim();
    const words = phrase.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && phrase.length > 5) {
      const head = words[words.length - 1].toLowerCase();
      const allGeneric = words.every(
        (w) => NON_SPECIFIC_ADJ.has(w.toLowerCase()) || GENERIC_HEADS.has(w.toLowerCase())
      );
      if (!allGeneric && !GENERIC_HEADS.has(head)) {
        const hasContentWord = words.some(
          (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase()) && !GENERIC_HEADS.has(w.toLowerCase()) && w.length > 2
        );
        if (hasContentWord) {
          const filtered = words.filter(
            (w) => !NON_SPECIFIC_ADJ.has(w.toLowerCase())
          );
          const cleaned = stripGenericEnding(filtered);
          if (cleaned.length >= 2) {
            entities.push({ type: "COMPOUND", text: cleaned.join(" ") });
          }
        }
      }
    }
  }
  return entities;
}
function extractEntities(text) {
  var _a2, _b;
  const raw = [];
  raw.push(...extractQuoted(text));
  raw.push(...extractProper(text));
  if (nlp) {
    raw.push(...extractCompoundsWithNlp(text));
  } else {
    raw.push(...extractCompoundsRegex(text));
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const entity of raw) {
    const key = entity.text.toLowerCase().trim();
    if (key.length > 2 && !seen.has(key)) {
      seen.add(key);
      deduped.push(entity);
    }
  }
  const cleaned = [];
  for (const entity of deduped) {
    let txt = entity.text.trim();
    txt = txt.replace(/^\*+\s*|\s*\*+$/g, "");
    txt = txt.replace(/\s*:+$/, "");
    txt = txt.replace(/^\d+\s*\.\s*/, "");
    txt = txt.replace(/[.,;!?]+$/, "").trim();
    if (!txt || txt.length <= 2 || hasArtifacts(txt)) {
      continue;
    }
    if (entity.type === "PROPER" && !txt.includes(" ") && GENERIC_CAPS.has(txt.toLowerCase())) {
      continue;
    }
    cleaned.push({ type: entity.type, text: txt });
  }
  const typePriority = {
    PROPER: 0,
    COMPOUND: 1,
    QUOTED: 2,
    NOUN: 3
  };
  const best = /* @__PURE__ */ new Map();
  for (const entity of cleaned) {
    const key = entity.text.toLowerCase();
    const existing = best.get(key);
    if (!existing || (_a2 = typePriority[entity.type]) != null ? _a2 : 99 < ((_b = typePriority[existing.type]) != null ? _b : 99)) {
      best.set(key, entity);
    }
  }
  const bestEntities = Array.from(best.values());
  const allLower = bestEntities.map((e) => e.text.toLowerCase());
  return bestEntities.filter(
    (entity) => !allLower.some(
      (other) => entity.text.toLowerCase() !== other && other.includes(entity.text.toLowerCase())
    )
  );
}
function extractEntitiesBatch(texts) {
  return texts.map(extractEntities);
}

// src/oss/src/utils/scoring.ts
var ENTITY_BOOST_WEIGHT = 0.5;
function getBm25Params(query, lemmatized) {
  const text = lemmatized != null ? lemmatized : query;
  const numTerms = text.trim().split(/\s+/).filter(Boolean).length || 1;
  if (numTerms <= 3) {
    return [5, 0.7];
  } else if (numTerms <= 6) {
    return [7, 0.6];
  } else if (numTerms <= 9) {
    return [9, 0.5];
  } else if (numTerms <= 15) {
    return [10, 0.5];
  } else {
    return [12, 0.5];
  }
}
function normalizeBm25(rawScore, midpoint, steepness) {
  return 1 / (1 + Math.exp(-steepness * (rawScore - midpoint)));
}
function scoreAndRank(semanticResults, bm25Scores, entityBoosts, threshold, topK) {
  var _a2, _b, _c;
  const hasBm25 = Object.keys(bm25Scores).length > 0;
  const hasEntity = Object.keys(entityBoosts).length > 0;
  let maxPossible = 1;
  if (hasBm25) {
    maxPossible += 1;
  }
  if (hasEntity) {
    maxPossible += ENTITY_BOOST_WEIGHT;
  }
  const scored = [];
  for (const result of semanticResults) {
    const memId = result.id;
    if (memId == null) {
      continue;
    }
    const semanticScore = (_a2 = result.score) != null ? _a2 : 0;
    if (semanticScore < threshold) {
      continue;
    }
    const memIdStr = String(memId);
    const bm25Score = (_b = bm25Scores[memIdStr]) != null ? _b : 0;
    const entityBoost = (_c = entityBoosts[memIdStr]) != null ? _c : 0;
    const rawCombined = semanticScore + bm25Score + entityBoost;
    const combined = Math.min(rawCombined / maxPossible, 1);
    scored.push({
      id: memIdStr,
      score: combined,
      payload: result.payload
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export { ENTITY_BOOST_WEIGHT, lemmatizeForBm25, extractEntities, extractEntitiesBatch, getBm25Params, normalizeBm25, scoreAndRank };
