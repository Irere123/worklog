#!/usr/bin/env bash
seconds=$1
shift
timeout "$seconds" "$@"
code=$?
if [ "$code" -eq 124 ]; then
  echo "::error::'$*' went over its ${seconds}s budget"
fi
exit "$code"
