#!/bin/bash

D=$(dirname "$BASH_SOURCE")
. "$D/../funcs.sh" || exit 1

# set working directory to tests
set_wd_tests


# 1: define a trait name-trait
# 2: implement the trait but with wong signature
# 3: implement the trait correctly using relative contract id
# 4: ensure contract id can't be used in 'implement trait'
# 5: implement name-trait using absolute contract id
# 6: make a successful trait impl call using trait as argument
# 7: ensure contract id can't be used in trait<> func args
# 8: call a import function that has a trait<> argument using a trait
#    impl referencing a trait with an absolute id to a
#    function expecting trait<> arg with relative id
# 9: successfully call a import function that has a trait<> argument

../src/c2c.js $@ -s -t -n mycontract trait/trait1.1.crystal && \
../src/c2c.js $@ -t -n trait12 --no-newdb trait/trait1.2.crystal && \
../src/c2c.js $@ -t -n trait13 --no-newdb trait/trait1.3.crystal && \
../src/c2c.js $@ -t -n trait14 --no-newdb trait/trait1.4.crystal && \
../src/c2c.js $@ -t -n trait15 --no-newdb trait/trait1.5.crystal && \
../src/c2c.js $@ -t -n trait16 --no-newdb trait/trait1.6.crystal && \
../src/c2c.js $@ -t -n trait17 --no-newdb trait/trait1.7.crystal && \
../src/c2c.js $@ -t -n trait18 --no-newdb trait/trait1.8.crystal &&
../src/c2c.js $@ -t -n trait19 --no-newdb trait/trait1.9.crystal

