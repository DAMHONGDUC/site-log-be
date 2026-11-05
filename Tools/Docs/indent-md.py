#!/usr/bin/env python3
"""Indent every section's content under its title in Markdown files.

Usage: python3 Tools/Docs/indent-md.py README.md ROADMAP.md docs

Markdown has no indentation, so content is wrapped in <dl><dd> (16 px per level on
GitHub; .vscode/markdown-preview.css does the same in VS Code). Safe to run again:
old wrappers are removed first, then rebuilt from the headings.
"""
import pathlib
import re
import sys

OPEN, CLOSE = '<dl><dd>', '</dd></dl>'
HEADING = re.compile(r'^(#{1,6}) ')
SECTION_SUMMARY = re.compile(r'^<summary><strong>.*</strong></summary>$')


def strip_wrappers(lines):
    return [line for line in lines if line not in (OPEN, CLOSE)]


def wrap_details_sections(lines):
    # Collapsible sub-sections (<details open> + <summary><strong>…</strong></summary>): indent their body.
    out, stack, in_fence = [], [], False
    for i, line in enumerate(lines):
        if line.startswith('```'):
            in_fence = not in_fence
        if in_fence:
            out.append(line)
            continue
        if line.startswith('<details'):
            is_section = i + 1 < len(lines) and SECTION_SUMMARY.match(lines[i + 1])
            stack.append(is_section)
        if line == '</details>' and stack:
            if stack.pop():
                out += ['', CLOSE]
        out.append(line)
        if SECTION_SUMMARY.match(line) and stack and stack[-1]:
            out += [OPEN, '']
    return out


def wrap_headings(lines):
    # Each heading's body is indented until the next heading of the same or higher level.
    # The page title (#) only wraps its intro, up to the next heading.
    out, open_levels, in_fence = [], [], False
    for line in lines:
        if line.startswith('```'):
            in_fence = not in_fence
        match = None if in_fence else HEADING.match(line)
        if match:
            level = len(match.group(1))
            while open_levels and (open_levels[-1] >= level or open_levels[-1] == 1):
                open_levels.pop()
                out += ['', CLOSE, '']
            out += [line, '', OPEN, '']
            open_levels.append(level)
            continue
        out.append(line)
    while open_levels:
        open_levels.pop()
        out += ['', CLOSE]
    return out


def format_file(path):
    lines = path.read_text().split('\n')
    lines = wrap_headings(wrap_details_sections(strip_wrappers(lines)))
    text = re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip() + '\n'
    path.write_text(text)


def main(args):
    for arg in args:
        target = pathlib.Path(arg)
        files = sorted(target.rglob('*.md')) if target.is_dir() else [target]
        for file in files:
            format_file(file)
            print(f'indented {file}')


if __name__ == '__main__':
    main(sys.argv[1:] or ['README.md', 'ROADMAP.md', 'docs'])
