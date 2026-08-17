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

_ASK =r"(?:hi |hey |hello )?(?:qbot[, ]*)?(?:can you |could you |please )*(?:tell me |remind me |do you know |i want to know |i'd like to know )*"
# Optional as a whole — the group has to close around the trailing \s* or the "?"
# at the call site would only make the whitespace optional, not the question word.
_WHAT = r"(?:(?:what(?:'s| is| are)?|whats|which|tell me)\s*)?"
_HERE = r"(?: (?:in|at) (?:the )?(?:company|org|organisation|organization|bluepeak|work))?(?: here)?(?: again)?"


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
