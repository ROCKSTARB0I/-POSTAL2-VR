#!/usr/bin/env python3
"""Bake every line of dialogue into audio using the system speech voices.

The browser's speech API is unreliable (and, once jammed, unfixable from inside
a page), so the game ships its own recordings instead. Run this whenever the
dialogue changes:

    python3 tools/render-voices.py

Writes voices/*.m4a plus voices/manifest.json, which the game loads at boot.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(ROOT, 'voices')

DUDE_VOICE = 'Fred'
DUDE_RATE = 165
# A spread of townsfolk -- mixed genders, accents and ages, so the crowd does
# not repeat itself. Deliberately excludes Ralph and other deep voices: the
# Dude (Fred) has to stay the lowest voice in Paradise.
NPC_VOICES = ['Samantha', 'Tom', 'Karen', 'Daniel', 'Moira', 'Tessa',
              'Kathy', 'Reed', 'Flo', 'Shelley', 'Rishi', 'Grandpa']
NPC_RATE = 180


def js_strings(text):
    """Pull single-quoted JS string literals out of a chunk of source."""
    out = []
    for m in re.finditer(r"'((?:[^'\\]|\\.)*)'", text):
        s = m.group(1).replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\')
        out.append(s)
    return out


def block(path, start_marker, end_marker):
    src = open(path, encoding='utf-8').read()
    i = src.find(start_marker)
    if i < 0:
        return ''
    j = src.find(end_marker, i + len(start_marker))
    return src[i:j if j > 0 else len(src)]


def collect():
    dude, npc = set(), set()

    # --- the Dude -------------------------------------------------------
    barks = open(os.path.join(SRC, 'barks.js'), encoding='utf-8').read()
    for m in re.finditer(r'lines:\s*\[(.*?)\]', barks, re.S):
        dude.update(js_strings(m.group(1)))

    errands = open(os.path.join(SRC, 'errands.js'), encoding='utf-8').read()
    for m in re.finditer(r"done:\s*('(?:[^'\\]|\\.)*')", errands):
        dude.update(js_strings(m.group(1)))
    for name in ('INTRO_LINES', 'DUDE_IDLE'):
        dude.update(js_strings(block(os.path.join(SRC, 'errands.js'),
                                     'export const %s' % name, '];')))

    game = open(os.path.join(SRC, 'game.js'), encoding='utf-8').read()
    m = re.search(r"const TAUNT_LINE\s*=\s*('(?:[^'\\]|\\.)*')", game)
    if m:
        dude.update(js_strings(m.group(1)))

    # --- everybody else -------------------------------------------------
    ents = os.path.join(SRC, 'entities.js')
    for name in ('CIV_LINES', 'PANIC_LINES', 'COP_LINES', 'THUG_LINES',
                 'LAUGH_LINES', 'GROSSED_LINES', 'GUNPULL_LINES',
                 'COMEBACK_LINES', 'DISGUST_LINES'):
        npc.update(js_strings(block(ents, 'export const %s' % name, '];')))

    clean = lambda s: s.strip()
    dude = sorted(c for c in map(clean, dude) if len(c) > 2)
    npc = sorted(c for c in map(clean, npc) if len(c) > 2)
    return dude, npc


def key_for(text, voice):
    h = hashlib.md5((voice + '|' + text).encode('utf-8')).hexdigest()[:12]
    return h + '.m4a'


def render(text, voice, rate, path):
    if os.path.exists(path):
        return True
    aiff = path.replace('.m4a', '.aiff')
    try:
        subprocess.run(['say', '-v', voice, '-r', str(rate), '-o', aiff, text],
                       check=True, capture_output=True)
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', aiff, path],
                       check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print('  ! failed: %s (%s)' % (text[:40], e))
        return False
    finally:
        if os.path.exists(aiff):
            os.remove(aiff)
    return True


def main():
    os.makedirs(OUT, exist_ok=True)
    dude, npc = collect()
    print('%d Dude lines, %d crowd lines x %d voices' % (len(dude), len(npc), len(NPC_VOICES)))

    manifest = {'dude': {}, 'npc': {}, 'npcVoices': len(NPC_VOICES)}
    done = 0

    for text in dude:
        name = key_for(text, DUDE_VOICE)
        if render(text, DUDE_VOICE, DUDE_RATE, os.path.join(OUT, name)):
            manifest['dude'][text] = name
        done += 1
        if done % 20 == 0:
            print('  ...%d' % done)

    for text in npc:
        files = []
        for voice in NPC_VOICES:
            name = key_for(text, voice)
            if render(text, voice, NPC_RATE, os.path.join(OUT, name)):
                files.append(name)
        if files:
            manifest['npc'][text] = files
        done += 1
        if done % 20 == 0:
            print('  ...%d' % done)

    # drop clips no longer referenced (voices removed from the cast, old lines)
    keep = set(manifest['dude'].values())
    for files in manifest['npc'].values():
        keep.update(files)
    orphans = [f for f in os.listdir(OUT) if f.endswith('.m4a') and f not in keep]
    for f in orphans:
        os.remove(os.path.join(OUT, f))
    if orphans:
        print('removed %d orphaned clips' % len(orphans))

    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=0)

    total = sum(os.path.getsize(os.path.join(OUT, f))
                for f in os.listdir(OUT) if f.endswith('.m4a'))
    print('done: %d clips, %.1f MB' % (
        len([f for f in os.listdir(OUT) if f.endswith('.m4a')]), total / 1e6))


if __name__ == '__main__':
    main()
