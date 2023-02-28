#!/bin/bash

D=$(dirname "$BASH_SOURCE")
. "$D/../funcs.sh" || exit 1

# set working directory to tests
set_wd_tests


../src/c2c.js $@ -s -t -n cc11 contract-call/cc1.1.crystal && \
../src/c2c.js $@ -t --no-newdb -n cc12 contract-call/cc1.2.crystal

