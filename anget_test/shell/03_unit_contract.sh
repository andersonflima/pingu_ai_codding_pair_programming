#!/bin/sh
set -eu

sum_plus_one() {
  value="${1:-0}"
  printf '%s\n' "$((value + 1))"
}
