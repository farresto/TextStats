#!/usr/bin/env python3
"""Builds vendor/lexicon/{en,es}.tsv.gz: every known word form -> its word classes.

Sources (see vendor/lexicon/SOURCES.md for licences):
  English  ESDB/SCOWL v2 (Kevin Atkinson)   data/scowl-pre.txt     word forms + parts of speech
  Spanish  FreeLing Spanish dictionary      data/es/dictionary     word forms + EAGLES tags
  Both     Universal Dependencies treebanks (EWT; AnCora + GSD)    which class a word usually has

A word that can belong to several classes ("vino": noun and verb) keeps all of them,
except classes that make up less than 5% of its uses in the treebanks.

Usage: python3 tools/build-lexicon.py <scowl-pre.txt> <freeling-es-entries-dir> \
           <en .conllu files, comma separated> <es .conllu files, comma separated> <out dir>
"""
import collections
import gzip
import os
import re
import sys

CLASSES = ['nouns', 'verbs', 'adjectives', 'adverbs', 'pronouns', 'determiners',
           'prepositions', 'conjunctions', 'interjections', 'numbers']
CODE = {c: c[0:2] for c in CLASSES}  # short codes in the output file
PRIORITY = ['nouns', 'verbs', 'adjectives', 'adverbs', 'pronouns', 'determiners',
            'prepositions', 'conjunctions', 'interjections', 'numbers']

UPOS = {
    'NOUN': 'nouns', 'PROPN': 'nouns', 'VERB': 'verbs', 'AUX': 'verbs', 'ADJ': 'adjectives',
    'ADV': 'adverbs', 'PRON': 'pronouns', 'DET': 'determiners', 'ADP': 'prepositions',
    'CCONJ': 'conjunctions', 'SCONJ': 'conjunctions', 'INTJ': 'interjections', 'NUM': 'numbers',
}


def ud_counts(paths):
    counts = collections.defaultdict(collections.Counter)
    for p in paths:
        with open(p, encoding='utf8') as f:
            for line in f:
                if not line or line[0] == '#' or line == '\n':
                    continue
                cols = line.rstrip('\n').split('\t')
                if len(cols) < 4 or '-' in cols[0] or '.' in cols[0]:
                    continue
                cls = UPOS.get(cols[3])
                if cls:
                    counts[cols[1].lower().replace('’', "'")][cls] += 1
    return counts


# Every class a word can have is kept. Classes that make up less than SHARE of the
# word's uses in the treebanks are marked "rare" with a trailing "?" (e.g. "canto":
# "nouns,verbs?"); the app keeps rare noun/verb/adjective/adverb uses for normal words
# and drops rare ones for function words ("the" is never shown as an adjective).
SHARE = 0.05
MIN_SEEN = 5


def choose(form, cands, ud, verb_forms=frozenset()):
    c = ud.get(form)
    total = sum(c.values()) if c else 0
    out = []
    for k in sorted(cands, key=PRIORITY.index):
        rare = total >= MIN_SEEN and c.get(k, 0) / total < SHARE
        out.append(k + ('?' if rare else ''))
    return out


# ------------------------------------------------------------------ English (SCOWL v2)

SCOWL_POS = {
    'n': ['nouns'], 'v': ['verbs'], 'm': ['verbs', 'nouns'], 'n_v': ['nouns', 'verbs'],
    # 'a' ("could be an adjective or adverb", unverified) is skipped: it adds noise such as house, book.
    'aj': ['adjectives'], 'av': ['adverbs'], 'aj_av': ['adjectives', 'adverbs'],
    'pn': ['pronouns'], 'c': ['conjunctions'], 'pp': ['prepositions'], 'd': ['determiners'], 'i': ['interjections'],
}
LEMMA_RE = re.compile(r"^(\S+) <([a-z_]+)(?:/([^>]*))?>")


def clean(word):
    word = word.strip()
    word = re.sub(r'^[-@!]', '', word) if len(word) > 1 else word
    word = re.sub(r'[*\-@~!†]+$', '', word)
    return word


def split_entries(text):
    out, depth, cur = [], 0, ''
    for ch in text:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    if cur:
        out.append(cur)
    words = []
    for e in out:
        e = e.strip()
        if e.startswith('('):
            for alt in e.strip('()').split('|'):
                words.append(alt.split(': ')[-1])
        else:
            words.append(e)
    return [clean(w) for w in words if w and clean(w) not in ('', '-')]


def english(scowl_path):
    cands = collections.defaultdict(set)
    verb_forms = set()
    group_lemma = None
    with open(scowl_path, encoding='utf8') as f:
        for raw in f:
            line = raw.rstrip('\n')
            if not line.strip():
                group_lemma = None
                continue
            if line.startswith('#'):
                continue
            line = line.split('#')[0].rstrip()
            parts = line.split(': ')
            for i in range(1, len(parts)):
                m = LEMMA_RE.match(parts[i])
                if not m:
                    continue
                lemma, pos = m.group(1), m.group(2)
                if lemma != '-':
                    group_lemma = clean(lemma)
                cls = SCOWL_POS.get(pos)
                if not cls or not group_lemma:
                    break
                forms = [group_lemma] + (split_entries(': '.join(parts[i + 1:])) if i + 1 < len(parts) else [])
                for k, w in enumerate(forms):
                    w = w.lower()
                    if not re.search(r'[a-z]', w) or ' ' in w:
                        continue
                    cands[w].update(cls)
                    if 'verbs' in cls and (k > 0 or lemma == '-'):
                        verb_forms.add(w)
                break
    return cands, verb_forms


# ------------------------------------------------------------------ Spanish (FreeLing)

EAGLES = {'N': 'nouns', 'V': 'verbs', 'A': 'adjectives', 'R': 'adverbs', 'P': 'pronouns', 'D': 'determiners',
          'S': 'prepositions', 'C': 'conjunctions', 'I': 'interjections', 'Z': 'numbers'}


def spanish(entries_dir):
    cands = collections.defaultdict(set)
    verb_forms = set()
    for name in sorted(os.listdir(entries_dir)):
        with open(os.path.join(entries_dir, name), encoding='utf8') as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                form = parts[0].lower()
                # one line can list several lemma/tag pairs
                for tag in parts[2::2]:
                    cls = EAGLES.get(tag[:1])
                    if cls and '_' not in form:
                        cands[form].add(cls)
                        # anything but the infinitive is a conjugated form
                        if cls == 'verbs' and tag[2:4] != 'N0':
                            verb_forms.add(form)
    return cands, verb_forms


def write(path, lex, ud):
    cands, verb_forms = lex
    by = collections.defaultdict(list)
    for form, cs in cands.items():
        by[','.join(choose(form, cs, ud, verb_forms))].append(form)
    with gzip.open(path, 'wt', encoding='utf8', compresslevel=9) as out:
        for key in sorted(by):
            out.write('#' + key + '\n')
            out.write('\n'.join(sorted(by[key])) + '\n')
    stats = collections.Counter()
    for key, forms in by.items():
        stats['several' if ',' in key else key] += len(forms)
    return dict(stats)


def main():
    scowl, es_dir, en_ud, es_ud, out = sys.argv[1:6]
    os.makedirs(out, exist_ok=True)
    print('en', write(os.path.join(out, 'en.tsv.gz'), english(scowl), ud_counts(en_ud.split(','))))
    print('es', write(os.path.join(out, 'es.tsv.gz'), spanish(es_dir), ud_counts(es_ud.split(','))))


if __name__ == '__main__':
    main()
