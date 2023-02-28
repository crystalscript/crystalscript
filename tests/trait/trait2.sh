#!/bin/bash

D=$(dirname "$BASH_SOURCE")
. "$D/../funcs.sh" || exit 1

# set working directory to tests
set_wd_tests

# 1: define trait compute
# 2: define trait name-lookup that uses compute
# 3: implement name-lookup
# 4: implement compute
# 5: call name-lookup.byid(int,trait<compute>) implemented by #3

../src/c2c.js $@ -s -t -n mycontract2 trait/trait2.1.crystal &&
../src/c2c.js $@ -t -n trait22 --no-newdb trait/trait2.2.crystal &&
../src/c2c.js $@ -t -n trait23 --no-newdb trait/trait2.3.crystal &&
../src/c2c.js $@ -t -n trait24 --no-newdb trait/trait2.4.crystal &&
../src/c2c.js $@ -t -n trait25 --no-newdb trait/trait2.5.crystal

