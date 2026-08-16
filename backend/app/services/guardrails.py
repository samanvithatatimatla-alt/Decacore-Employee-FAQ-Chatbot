"""Cheap, deterministic scope checks that run *before* retrieval.

Every message used to go straight into search + the LLM, so "hi" retrieved three
loosely-matching policy chunks and came back as a three-paragraph answer with
citations attached. Anything that is plainly not an HR question is answered here
instead: no embedding call, no search, no citations, no escalation offer.

Matching is intentionally conservative. A false positive here means a real HR
question gets a canned brush-off, which is far worse than a chatty message
slipping through to the normal path, so every rule below requires either an exact
match on a short message or an unambiguous phrase.
"""

from __future__ import annotations

import re

SCOPE_BLURB = (
    "I can answer questions about BluePeak HR policies — leave and PTO, benefits and "
    "insurance, payroll, travel, and reimbursements."
)

GREETING_REPLY = f"Hi! {SCOPE_BLURB} What would you like to know?"
THANKS_REPLY = "Happy to help. Anything else you'd like to look up?"
FAREWELL_REPLY = "Take care — come back any time you need a policy answer."
IDENTITY_REPLY = (
    f"I'm QBot, BluePeak's HR assistant. {SCOPE_BLURB} Every answer comes from the "
    "approved policy documents you have access to, with a citation you can open."
)
OUT_OF_SCOPE_REPLY = (
    f"That's outside what I can help with. {SCOPE_BLURB} If your question is an HR one, "
    "try asking it directly and I'll look it up."
)

# Exact-match sets. Checked against the whole message with punctuation stripped, so
# "hi" is caught but "hi, how much PTO do I have?" falls through to retrieval.
GREETINGS = {
    "hi", "hii", "hiii", "hey", "heya", "hello", "hallo", "yo", "sup", "howdy",
    "good morning", "good afternoon", "good evening", "hi there", "hello there",
    "hey there", "morning", "hi qbot", "hello qbot", "hey qbot",
    "how are you", "how are you doing", "how's it going", "hows it going",
    "what's up", "whats up",
}
THANKS = {
    "thanks", "thank you", "thx", "ty", "thanks!", "thank you!", "much appreciated",
    "appreciate it", "thanks a lot", "thank you so much", "perfect", "great", "nice",
    "cool", "awesome", "ok", "okay", "k", "got it", "sounds good", "understood",
}
FAREWELLS = {"bye", "goodbye", "bye bye", "see you", "see ya", "later", "cya", "good night", "goodnight"}
IDENTITY = {
    "who are you", "what are you", "what is this", "what do you do", "what can you do",
    "what can you help with", "what can i ask you", "help", "what can you help me with",
    "who am i talking to", "what is qbot", "who is qbot",
}

# Unambiguous non-HR asks. These are phrase matches rather than single keywords:
# "code" alone appears in "dress code", and "write" in "who do I write to about
# my leave request".
OUT_OF_SCOPE_PATTERNS = [
    r"\bwrite (me )?(a |some )?(python|java|javascript|sql|c\+\+|go|rust|bash|shell)\b",
    r"\bwrite (me )?(a |an )?(poem|song|story|essay|joke|rap|haiku)\b",
    r"\btell me a joke\b",
    r"\b(what|hows|what's|how's) the weather\b",
    r"\bwho (won|is winning)\b.*\b(game|match|election|world cup|super bowl)\b",
    r"\b(translate|summarise|summarize) (this|the following|that) (into|to|in) \w+",
    r"\bgive me a recipe\b",
    r"\bwhat('s| is) the (stock|share) price\b",
    r"\bdebug (this|my) (code|function|script)\b",
    r"\bwrite (a |an )?(unit )?test(s)? for\b",
    r"\bwho (is|was) the (president|prime minister|ceo of (?!bluepeak))",
    # Prompt-injection style attempts to shed the HR scope.
    r"\bignore (all |your |the )?(previous |prior |above )?instructions\b",
    r"\byou are (now|no longer) (a|an|the)\b",
    r"\b(system|developer) prompt\b",
    r"\bpretend (to be|you are)\b",
]

_PUNCT = re.compile(r"[^\w\s'&+]")


def _normalize(text: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace."""
    return " ".join(_PUNCT.sub(" ", text.lower()).split())


def canned_reply(message: str) -> str | None:
    """Return a fixed reply for a message that needs no policy lookup, else None."""
    norm = _normalize(message)
    if not norm:
        return GREETING_REPLY

    # Exact matches only: a greeting bolted onto a real question is a real question.
    if norm in GREETINGS:
        return GREETING_REPLY
    if norm in THANKS:
        return THANKS_REPLY
    if norm in FAREWELLS:
        return FAREWELL_REPLY
    if norm in IDENTITY:
        return IDENTITY_REPLY

    for pattern in OUT_OF_SCOPE_PATTERNS:
        if re.search(pattern, norm):
            return OUT_OF_SCOPE_REPLY

    return None
