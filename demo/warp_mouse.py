#!/usr/bin/env python3
"""Move and click the macOS pointer so record-bot's cursor log can follow a demo."""

from __future__ import annotations

import sys
import time
from ctypes import CDLL, Structure, c_double, c_uint32, c_void_p

kCGEventLeftMouseDown = 1
kCGEventLeftMouseUp = 2
kCGHIDEventTap = 0
kCGMouseButtonLeft = 0
CLICK_HOLD_SECONDS = 0.09


class CGPoint(Structure):
    _fields_ = [("x", c_double), ("y", c_double)]


def load_core_graphics():
    cg = CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cg.CGEventCreate.argtypes = [c_void_p]
    cg.CGEventCreate.restype = c_void_p
    cg.CGEventGetLocation.argtypes = [c_void_p]
    cg.CGEventGetLocation.restype = CGPoint
    cg.CGWarpMouseCursorPosition.argtypes = [CGPoint]
    cg.CGWarpMouseCursorPosition.restype = c_uint32
    cg.CGAssociateMouseAndMouseCursorPosition.argtypes = [c_uint32]
    cg.CGAssociateMouseAndMouseCursorPosition.restype = c_uint32
    cg.CGEventCreateMouseEvent.argtypes = [c_void_p, c_uint32, CGPoint, c_uint32]
    cg.CGEventCreateMouseEvent.restype = c_void_p
    cg.CGEventPost.argtypes = [c_uint32, c_void_p]
    cg.CGEventPost.restype = None
    return cg


def current_location(cg) -> CGPoint:
    return cg.CGEventGetLocation(cg.CGEventCreate(None))


def post_button(cg, down: bool) -> None:
    event_type = kCGEventLeftMouseDown if down else kCGEventLeftMouseUp
    event = cg.CGEventCreateMouseEvent(None, event_type, current_location(cg), kCGMouseButtonLeft)
    cg.CGEventPost(kCGHIDEventTap, event)


def move_to(cg, target_x: float, target_y: float, steps: int) -> int:
    origin = current_location(cg)
    count = max(1, steps)
    for index in range(1, count + 1):
        mix = index / count
        ease = mix * mix * (3 - 2 * mix)
        err = cg.CGWarpMouseCursorPosition(
            CGPoint(
                origin.x + (target_x - origin.x) * ease,
                origin.y + (target_y - origin.y) * ease,
            )
        )
        if err != 0:
            return 1
        time.sleep(0.014)
    cg.CGAssociateMouseAndMouseCursorPosition(1)
    return 0


def click_current(cg) -> int:
    post_button(cg, True)
    time.sleep(CLICK_HOLD_SECONDS)
    post_button(cg, False)
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        return 1
    cg = load_core_graphics()
    if sys.argv[1] == "click":
        return click_current(cg)
    if sys.argv[1] == "down":
        post_button(cg, True)
        return 0
    if sys.argv[1] == "up":
        post_button(cg, False)
        return 0
    if len(sys.argv) < 3:
        return 1
    target_x = float(sys.argv[1])
    target_y = float(sys.argv[2])
    steps = max(1, int(sys.argv[3]) if len(sys.argv) > 3 else 24)
    return move_to(cg, target_x, target_y, steps)


if __name__ == "__main__":
    raise SystemExit(main())
