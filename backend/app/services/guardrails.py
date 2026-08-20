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
from dataclasses import dataclass
from datetime import date

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


@dataclass
class UserProfile:
    """The asking employee's own record, copied out of the ORM session.

    The chat stream is generated after the request session closes, so this has to
    be a plain snapshot rather than the `User` row itself.
    """

    display_name: str
    role: str
    email: str
    department: str | None = None
    manager_name: str | None = None
    hire_date: date | None = None


ROLE_LABELS = {
    "HRAdmin": "HR Administrator",
    "Employee": "Employee",
    "Manager": "Manager",
    "Executive": "Executive",
}

_ASK = r"(?:hi |hey |hello )?(?:qbot[, ]*)?(?:can you |could you |please )*(?:tell me |remind me |do you know |i want to know |i'd like to know )*"
# Optional as a whole — the group has to close around the trailing \s* or the "?"
# at the call site would only make the whitespace optional, not the question word.
_WHAT = r"(?:(?:what(?:'s| is| are)?|whats|which|tell me)\s*)?"
# Determiners matter here: the first version accepted "in the company" but not "in
# this company", which is how people actually phrase it.
_HERE = (
    r"(?: (?:in|at|for|with) (?:the |this |our |my )?"
    r"(?:company|org|organisation|organization|firm|business|team|bluepeak|work|office))?"
    r"(?: here)?(?: currently| right now| now)?(?: again)?"
)


def _full(pattern: str) -> re.Pattern[str]:
    """Anchor a pattern to the whole message, allowing a polite lead-in."""
    return re.compile(rf"^{_ASK}(?:{pattern}){_HERE}$")


# Questions an employee asks about *themselves*. These never had an answer: the
# record lives in the users table, not in any policy PDF, so retrieval came back
# empty and the bot offered to escalate "what is my role" to HR.
#
# Every pattern is a full-message match. A loose "my role" substring would swallow
# "what is the PTO policy for my role", which is a real retrieval question.
_ROLE_NOUN = r"(?:role|job title|title|position|designation|access level|permission level|access)"
_DEPT_NOUN = r"(?:department|dept|team|division|business unit)"
_MANAGER_NOUN = r"(?:manager|reporting manager|line manager|supervisor|boss)"
_JOIN_NOUN = r"(?:hire date|start date|joining date|date of joining|start day)"

PROFILE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (_full(rf"{_WHAT}my {_ROLE_NOUN}|my {_ROLE_NOUN} is|what (?:role|title) do i have"), "role"),
    (_full(r"am i (?:an? )?(?:hr|hr admin|admin|administrator|manager|employee|executive)"), "role"),
    (_full(r"(?:who am i|who i am|what am i)"), "who"),
    (_full(rf"{_WHAT}my (?:name|profile|details|info|information)|my (?:name|profile) is"), "who"),
    (_full(rf"{_WHAT}my {_DEPT_NOUN}|my {_DEPT_NOUN} is|(?:which|what) {_DEPT_NOUN} am i in|am i in (?:which|what) {_DEPT_NOUN}|where do i work"), "department"),
    (_full(rf"{_WHAT}my {_MANAGER_NOUN}|my {_MANAGER_NOUN} is|who(?:'s| is)? my {_MANAGER_NOUN}|who do i report to"), "manager"),
    (_full(rf"{_WHAT}my {_JOIN_NOUN}|my {_JOIN_NOUN} is|when did i (?:join|start)|how long have i (?:been|worked)(?: here| with the company| at bluepeak)?"), "hire_date"),
    (_full(r"(?:what(?:'s| is)?|whats)?\s*my (?:email|email address|work email)"), "email"),
]


# A loose "is this about the person asking?" test, used to decide whether the model
# should be told who is asking.
#
# Deliberately far looser than PROFILE_PATTERNS above, because the consequences are
# different. A PROFILE_PATTERNS match replaces the whole answer with fixed text, so a
# false positive turns a real policy question into a brush-off and the patterns have
# to be exact. A match here only *adds* the asker's record to the prompt — the policy
# excerpts still go along with it and the model still answers normally — so a false
# positive costs about forty tokens and nothing else. That is what lets this be a
# keyword test instead of an ever-growing list of phrasings.
_FIRST_PERSON = re.compile(r"\b(?:my|mine|i|i'm|im|me)\b")
# Identity signals: mostly nouns, plus a few short phrases where the noun alone would
# be too broad. "how long have i been" is here; a bare "work" is not, because "can I
# work from home" is a policy question, and matching it would suppress the offer to
# send it to HR when no policy covers it.
_PROFILE_NOUNS = re.compile(
    r"\b(?:role|roles|title|position|designation|department|dept|team|division|"
    r"manager|supervisor|boss|report|reports|reporting|joined|join|joining|hire|hired|"
    r"start date|started|tenure|seniority|email|name|profile|access|permission|"
    r"job title|job role|how long have i|worked here|working here|been here|admin|administrator|hr admin|"
    # "who do i work for" and "who is my employer" are about the asker as surely as
    # "what is my role" is, and without them the record never reached the model: the
    # reply was that the documents do not say who your manager is, while the record
    # held it. "work for" and not "work", so "can I work from home" stays a policy
    # question.
    r"work for|works for|employer|employed by)\b"
)


def mentions_self(message: str) -> bool:
    """True when the message plausibly asks about the person sending it."""
    norm = _normalize(message)
    return bool(_FIRST_PERSON.search(norm) and _PROFILE_NOUNS.search(norm))


def organisation(display_name: str) -> str | None:
    """The organisation the sign-in directory records for this person.

    Entra returns "Archit Jaiswal (Quadrant Technologies)". That parenthesis is the
    only statement of an employer the app actually holds, so it is passed on as one
    rather than left for the model to infer from an email domain — which it would not
    do, leaving "who is my employer" answered with a shrug.
    """
    match = re.search(r"\(([^)]+)\)\s*$", display_name or "")
    return match.group(1).strip() or None if match else None


def profile_context(profile: UserProfile | None) -> str | None:
    """The asker's own record, formatted for the model's prompt."""
    if profile is None:
        return None
    org = organisation(profile.display_name)
    facts = [
        f"Name: {profile.display_name}",
        *([f"Organisation on their sign-in record: {org}"] if org else []),
        f"Role: {ROLE_LABELS.get(profile.role, profile.role)}",
        f"Email: {profile.email}",
    ]
    if profile.department:
        facts.append(f"Department: {profile.department}")
    if profile.manager_name:
        facts.append(f"Manager: {profile.manager_name}")
    if profile.hire_date:
        facts.append(f"Joined: {profile.hire_date.strftime('%d %B %Y')}")
    return "\n".join(facts)


def _profile_lines(profile: UserProfile) -> list[str]:
    role = ROLE_LABELS.get(profile.role, profile.role)
    lines = [f"You're signed in as {profile.display_name} ({role})."]
    if profile.department:
        lines.append(f"Department: {profile.department}.")
    if profile.manager_name:
        lines.append(f"Manager: {profile.manager_name}.")
    return lines


def profile_reply(message: str, profile: UserProfile | None) -> str | None:
    """Answer a question about the asker's own record, else None."""
    if profile is None:
        return None
    norm = _normalize(message)
    if not norm:
        return None

    topic = next((topic for pattern, topic in PROFILE_PATTERNS if pattern.match(norm)), None)
    if topic is None:
        return None

    role = ROLE_LABELS.get(profile.role, profile.role)
    if topic == "role":
        parts = [f"You're signed in as {profile.display_name}, and your role is {role}."]
        if profile.department:
            parts.append(f"You sit in the {profile.department} department.")
        if profile.role == "HRAdmin":
            parts.append("That gives you the HR tools — document management, the HR inbox and the dashboard.")
        parts.append("If your role or department looks wrong, HR can correct it in your employee record.")
        return " ".join(parts)
    if topic == "who":
        return " ".join(_profile_lines(profile) + [f"Email: {profile.email}."])
    if topic == "department":
        if not profile.department:
            return "Your employee record doesn't have a department set. HR can add it for you."
        return f"You're in the {profile.department} department. Your role there is {role}."
    if topic == "manager":
        if not profile.manager_name:
            return "Your employee record doesn't list a manager. HR can confirm who you report to."
        return f"You report to {profile.manager_name}."
    if topic == "hire_date":
        if not profile.hire_date:
            return "Your employee record doesn't have a hire date on it. HR can confirm your start date."
        return f"Your record shows you joined on {profile.hire_date.strftime('%d %B %Y')}."
    if topic == "email":
        return f"The email on your account is {profile.email}."
    return None


# Phrases the model uses when the corpus does not cover the question. It says so in
# its own words — "the policy documents don't address bringing pets to the office, so
# this isn't covered and I can forward the question to HR" — while retrieval still
# scored well enough to look confident, so no Send to HR button appeared. The employee
# was told to take an action the screen did not offer, and the natural workaround
# ("go ahead and forward it") is read as a brand new question and filed as one.
ADMITS_GAP = re.compile(
    r"do(es)?\s*n[o']t\s+(address|mention|cover|state|specify|define|include)"
    r"|\bnot\s+(covered|addressed|mentioned|specified)\b"
    r"|\bno\s+(policy|documents?)\s+(covers?|addresses|mentions)"
    r"|\bforward\s+(this|the|your)\s+(question|request)?\s*to\s+hr"
    r"|\bescalate\s+(this|it)\s+to\s+hr",
    re.I,
)


# The answer says the thing asked for is not allowed, rather than explaining how to do
# it. Distinct from admitting a gap: the documents cover this perfectly well, and the
# answer is no.
REFUSES_REQUEST = re.compile(
    r"\bnot\s+(?:reimbursable|eligible|covered\s+by|permitted|allowed|approved|available)\b"
    r"|\bis\s+not\s+a\s+(?:reimbursable|covered|qualifying)\b"
    r"|\bcannot\s+be\s+(?:reimbursed|claimed|used|carried)\b"
    r"|\bdoes\s+not\s+(?:qualify|offer|provide|reimburse)\b"
    r"|\bdo\s+not\s+qualify\b|\bnon-?reimbursable\b|\bare\s+excluded\b",
    re.I,
)


def answer_refuses_request(answer: str) -> bool:
    """Did the answer say no?

    A form is an offer to go and do the thing. Offering one under "personal meals are
    not reimbursable" invites the employee to file a claim the policy has just refused,
    which is worse than offering nothing.

    Only the opening sentence counts, because the answer leads with the verdict and
    then qualifies it. A yes that goes on to name an exclusion — "yes, if it had a
    business purpose … alcohol is not reimbursable" — is still a yes, and reading the
    whole answer withdrew the form from it.
    """
    opening = re.split(r"(?<=[.!?])\s+", answer.strip(), maxsplit=1)[0] if answer.strip() else ""
    return bool(REFUSES_REQUEST.search(opening))


def answer_admits_gap(answer: str) -> bool:
    """Did the model itself say the documents do not cover this?

    Checked after generation, because only then does the answer exist. The relevance
    score cannot see it: "can I bring my cat to work" retrieves the workplace policies
    perfectly well, and they are genuinely the right documents — they simply have
    nothing to say about pets.
    """
    return bool(ADMITS_GAP.search(answer))


# Someone answering the offer to escalate, rather than asking something new. Typed
# because the bot said it could forward the question, so the reply is an instruction
# to the app, not a question for the corpus. Searching it finds nothing, and pressing
# Send to HR on the result files "go ahead and forward it" as the question.
FORWARD_REQUESTS = re.compile(
    r"^(yes\s*)?(please\s*)?(go\s+ahead\s+(and\s+)?)?"
    r"(forward|send|escalate)\s*(it|this|that|the\s+question)?"
    r"(\s+to\s+hr)?[.!]?$",
    re.I,
)

FORWARD_REPLY = (
    "I can't send it from here — use the Send to HR button on the answer above and it "
    "goes across with your original question and my reply attached."
)


def only_about_self(message: str, profile: UserProfile | None) -> bool:
    """Is every part of this message answerable from the employee record?

    Asked because people combine them — "who am I? what is my role?" is two questions
    the record answers individually, but the strict patterns match neither the pair nor
    the joined string, so it fell through to policy search and came back with the
    corporate card policy cited underneath the person's own job title.
    """
    if profile is None:
        return False
    parts = [p.strip() for p in re.split(r"[?.;,]|\band\b", message) if p.strip()]
    if not parts:
        return False
    return all(profile_reply(part, profile) is not None for part in parts)


def canned_reply(message: str) -> str | None:
    """Return a fixed reply for a message that needs no policy lookup, else None."""
    norm = _normalize(message)
    if not norm:
        return GREETING_REPLY

    if FORWARD_REQUESTS.match(norm):
        return FORWARD_REPLY

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
