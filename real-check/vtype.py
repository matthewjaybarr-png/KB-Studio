#!/usr/bin/python3
"""Type text into a libvirt guest with virsh send-key: vtype.py <domain> <text> [--enter]"""
import subprocess, sys, time
SHIFT = {'~': 'GRAVE', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': 'MINUS', '+': 'EQUAL',
         '{': 'LEFTBRACE', '}': 'RIGHTBRACE', '|': 'BACKSLASH', ':': 'SEMICOLON', '"': 'APOSTROPHE', '<': 'COMMA', '>': 'DOT', '?': 'SLASH'}
PLAIN = {' ': 'SPACE', '-': 'MINUS', '=': 'EQUAL', '[': 'LEFTBRACE', ']': 'RIGHTBRACE', '\\': 'BACKSLASH', ';': 'SEMICOLON', "'": 'APOSTROPHE',
         ',': 'COMMA', '.': 'DOT', '/': 'SLASH', '`': 'GRAVE'}
def key(c):
    if c.isalpha(): return (['KEY_LEFTSHIFT'] if c.isupper() else []) + ['KEY_' + c.upper()]
    if c.isdigit(): return ['KEY_' + c]
    if c in PLAIN: return ['KEY_' + PLAIN[c]]
    return ['KEY_LEFTSHIFT', 'KEY_' + SHIFT[c]]
dom, text = sys.argv[1], sys.argv[2]
for c in text:  # one key a call: a call's keys are pressed together
    subprocess.run(['virsh', '-c', 'qemu:///system', 'send-key', dom, '--codeset', 'linux', *key(c)], check=True, stdout=subprocess.DEVNULL)
    time.sleep(0.03)
if '--enter' in sys.argv: subprocess.run(['virsh', '-c', 'qemu:///system', 'send-key', dom, '--codeset', 'linux', 'KEY_ENTER'], check=True, stdout=subprocess.DEVNULL)
