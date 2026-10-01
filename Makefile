SWIFT ?= swiftc
MACOS_MIN := macos14.0
SRC := native/darwin
OUT := native/bin
CACHE := $(or $(TMPDIR),/tmp)/record-bot-swift
STAGE := .release-files
FFMPEG_CACHE := .cache/ffmpeg
FFMPEG_REL := b6.1.1
FFMPEG_BASE := https://github.com/eugeneware/ffmpeg-static/releases/download/$(FFMPEG_REL)

.PHONY: capture capture-if-needed cursors bundle f5-tts demo modal-login modal-token-set modal-record
MODAL := PYTHONPATH=$(CURDIR)/cloud/pythonpath$(if $(PYTHONPATH),:$(PYTHONPATH)) uv run --with modal modal

ifeq ($(shell uname -s),Darwin)
HOST_TAG := $(if $(filter arm64,$(shell uname -m)),darwin-arm64,darwin-x64)

capture: \
	$(OUT)/darwin-arm64/capture \
	$(OUT)/darwin-arm64/sources \
	$(OUT)/darwin-arm64/cursor \
	$(OUT)/darwin-x64/capture \
	$(OUT)/darwin-x64/sources \
	$(OUT)/darwin-x64/cursor

$(OUT)/darwin-arm64/capture: $(SRC)/Capture.swift
	@mkdir -p $(dir $@) $(CACHE)
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target arm64-apple-$(MACOS_MIN) $< -o $@
	@chmod 755 $@

$(OUT)/darwin-arm64/sources: $(SRC)/ListSources.swift
	@mkdir -p $(dir $@) $(CACHE)
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target arm64-apple-$(MACOS_MIN) $< -o $@
	@chmod 755 $@

$(OUT)/darwin-arm64/cursor: $(SRC)/CursorLog.swift
	@mkdir -p $(dir $@) $(CACHE)
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target arm64-apple-$(MACOS_MIN) $< -o $@
	@chmod 755 $@

$(OUT)/darwin-x64/capture: $(SRC)/Capture.swift
	@mkdir -p $(dir $@) $(CACHE)
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target x86_64-apple-$(MACOS_MIN) $< -o $@
	@chmod 755 $@

$(OUT)/darwin-x64/sources: $(SRC)/ListSources.swift
	@mkdir -p $(dir $@) $(CACHE)
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target x86_64-apple-$(MACOS_MIN) $< -o $@
	@chmod 755 $@

$(OUT)/darwin-x64/cursor: $(SRC)/CursorLog.swift
	@mkdir -p $(dir $@) $(CACHE)
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target x86_64-apple-$(MACOS_MIN) $< -o $@
	@chmod 755 $@

capture-if-needed:
	@if [ -x $(OUT)/$(HOST_TAG)/capture ] && [ -x $(OUT)/$(HOST_TAG)/sources ] && [ -x $(OUT)/$(HOST_TAG)/cursor ]; then \
		exit 0; \
	fi; \
	$(MAKE) capture

# Regenerate cursor sprites from the real macOS system cursors (macOS-only).
cursors: $(SRC)/ExportCursors.swift
	@mkdir -p $(CACHE) assets/cursors
	CLANG_MODULE_CACHE_PATH=$(CACHE)/clang SWIFT_MODULECACHE_PATH=$(CACHE)/swift \
		$(SWIFT) -O -target arm64-apple-$(MACOS_MIN) $< -o $(CACHE)/export-cursors
	$(CACHE)/export-cursors assets/cursors 128
else
capture:
	@echo "capture tools are macOS-only; skipping"

capture-if-needed:
	@true

cursors:
	@echo "cursor sprites are regenerated on macOS; using the committed assets"
endif

# $(1) goreleaser key  $(2) ffmpeg os  $(3) ffmpeg arch  $(4) filename
define PUT_FFMPEG
	mkdir -p $(FFMPEG_CACHE) $(STAGE)/$(1)/helpers
	cached="$(FFMPEG_CACHE)/$(2)-$(3)-$(4)"; \
	if [ ! -f "$$cached" ]; then \
		echo "fetching ffmpeg $(2)-$(3)"; \
		curl -fsSL -A record-bot -o "$$cached.gz" "$(FFMPEG_BASE)/ffmpeg-$(2)-$(3).gz"; \
		gzip -dc "$$cached.gz" > "$$cached"; \
		chmod 755 "$$cached"; \
	fi; \
	cp "$$cached" "$(STAGE)/$(1)/helpers/$(4)"; \
	chmod 755 "$(STAGE)/$(1)/helpers/$(4)"; \
	curl -fsSL -A record-bot -o "$(STAGE)/$(1)/helpers/ffmpeg.LICENSE" "$(FFMPEG_BASE)/$(2)-$(3).LICENSE" || true
endef

f5-tts:
	uv venv .venv --python 3.12
	uv pip install --python .venv/bin/python -r python/requirements.txt

demo:
	node demo/record.ts

modal-login:
	$(MODAL) token new

modal-token-set:
	$(MODAL) token set --no-verify --profile default

modal-record:
	$(MODAL) run cloud/record.py

define PUT_DARWIN
	mkdir -p $(STAGE)/$(1)/helpers
	cp $(OUT)/$(2)/capture $(OUT)/$(2)/sources $(OUT)/$(2)/cursor $(STAGE)/$(1)/helpers/
	chmod 755 $(STAGE)/$(1)/helpers/capture $(STAGE)/$(1)/helpers/sources $(STAGE)/$(1)/helpers/cursor
endef

bundle:
	rm -rf $(STAGE)
	@test -x $(OUT)/darwin-arm64/capture || { echo "missing darwin-arm64 helpers; run make capture"; exit 1; }
	@test -x $(OUT)/darwin-x64/capture || { echo "missing darwin-x64 helpers; run make capture"; exit 1; }
	$(call PUT_DARWIN,darwin_arm64,darwin-arm64)
	$(call PUT_FFMPEG,darwin_arm64,darwin,arm64,ffmpeg)
	$(call PUT_DARWIN,darwin_amd64,darwin-x64)
	$(call PUT_FFMPEG,darwin_amd64,darwin,x64,ffmpeg)
	$(call PUT_FFMPEG,linux_arm64,linux,arm64,ffmpeg)
	$(call PUT_FFMPEG,linux_amd64,linux,x64,ffmpeg)
	$(call PUT_FFMPEG,windows_amd64,win32,x64,ffmpeg.exe)
