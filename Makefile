PROBLEM ?= 1480
SOLUTION ?= master
MODE ?= debug

.PHONY: help setup run doctor test serve
help:
	@printf '%s\n' 'make setup' 'make run PROBLEM=589 SOLUTION=non-recursive MODE=debug' 'make doctor' 'make test' 'make serve'
setup:
	npm ci
	npm run setup
run:
	./run-test.sh "$(PROBLEM)" "$(SOLUTION)" --mode "$(MODE)"
doctor:
	./wb.sh doctor
test:
	npm test
serve:
	npm start
