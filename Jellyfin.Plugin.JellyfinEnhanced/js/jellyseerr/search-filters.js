// Adds a row of toggle chips (Movies, Series, Songs, Album, Artist) to
// Jellyfin's native search page, letting a viewer narrow results down to
// just the types they care about instead of scrolling past everything.
//
// Three different kinds of section live on that page and each needs a
// different filtering approach:
//   - Native Jellyfin sections (Movies, Series/Shows, Songs, Albums,
//     Artists, People, ...): plain .verticalSection elements with a
//     .sectionTitle child whose text names the section. Matched loosely
//     (case-insensitive, singular/plural) since the exact label can vary by
//     Jellyfin version/language, and the whole section is shown or hidden.
//   - The "Discover Music on Seerr" row (music.js): every card in it is an
//     artist match (see music.ts's /search route upstream), so the whole
//     row maps to the Artist chip, same as a native section.
//   - The "Discover on Seerr" row (jellyseerr.js): mixes movie and show
//     cards in one row, each carrying Jellyseerr's own data-media-type
//     attribute (see ui-cards.js's createJellyseerrCard), so this one needs
//     per-card filtering rather than whole-section filtering.
(function(JE) {
    'use strict';

    const STYLE_ID = 'je-search-filters-styles';
    const BAR_ID = 'je-search-filter-bar';
    const HIDDEN_CARD_CLASS = 'je-search-filter-card-hidden';

    // Empty set = no filter applied, everything shows (the default state).
    const activeTypes = new Set();

    // JE.t(key, params) treats a truthy second argument as a params object
    // for {placeholder} substitution (Object.entries on it) -- passing a
    // plain fallback string there makes it iterate the string's characters
    // as numeric keys and build `new RegExp('{0}', 'g')`, which throws
    // (invalid regex, nothing to repeat). JE.t(key) alone already falls
    // back to the key itself when untranslated, so just call it with one
    // argument and swap in our own fallback text locally -- same wrapper
    // music.js uses for the same reason.
    function t(key, fallback) {
        const translated = typeof JE.t === 'function' ? JE.t(key) : key;
        return translated === key ? fallback : translated;
    }

    const TYPE_ORDER = ['movie', 'series', 'song', 'album', 'artist'];
    const TYPE_LABEL_KEYS = {
        movie: ['search_filter_movies', 'Movies'],
        series: ['search_filter_series', 'Series'],
        song: ['search_filter_songs', 'Songs'],
        album: ['search_filter_album', 'Album'],
        artist: ['search_filter_artist', 'Artist'],
    };

    const NATIVE_SECTION_MATCHERS = {
        movie: /^movies?$/i,
        series: /^(series|shows?)$/i,
        song: /^songs?$/i,
        album: /^albums?$/i,
        artist: /^artists?$/i,
    };

    function injectStyles() {
        if (document.getElementById(STYLE_ID) || !document.head) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .je-search-filter-bar { display: flex; flex-wrap: wrap; gap: 0.5em; padding: 0 1.8em 1em; }
            .je-search-filter-chip {
                border: 1px solid rgba(255,255,255,0.3); background: transparent; color: inherit;
                border-radius: 1em; padding: 0.3em 1em; font-size: 0.9em; cursor: pointer;
            }
            .je-search-filter-chip:hover { border-color: rgba(255,255,255,0.6); }
            .je-search-filter-chip-active { background: #7c3aed; border-color: #7c3aed; }
            .${HIDDEN_CARD_CLASS} { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    function sectionNativeType(section) {
        const title = section.querySelector('.sectionTitle')?.textContent?.trim();
        if (!title) return null;
        for (const type of TYPE_ORDER) {
            if (NATIVE_SECTION_MATCHERS[type].test(title)) return type;
        }
        return null;
    }

    function applyFilterToSection(section) {
        if (section.id === BAR_ID) return;

        // The movie/show discover row mixes card types -- filter per card.
        if (section.classList.contains('jellyseerr-section')) {
            const cards = section.querySelectorAll('.jellyseerr-card');
            let anyVisible = activeTypes.size === 0;
            cards.forEach((card) => {
                const mediaType = card.querySelector('[data-media-type]')?.dataset.mediaType;
                const type = mediaType === 'tv' ? 'series' : mediaType === 'movie' ? 'movie' : null;
                const show = activeTypes.size === 0 || (!!type && activeTypes.has(type));
                card.classList.toggle(HIDDEN_CARD_CLASS, !show);
                if (show) anyVisible = true;
            });
            section.classList.toggle('section-hidden', !anyVisible);
            return;
        }

        // The music discover row is artist-only end to end.
        if (section.id === 'je-music-search-section') {
            section.classList.toggle('section-hidden', !(activeTypes.size === 0 || activeTypes.has('artist')));
            return;
        }

        // A native Jellyfin section. One we don't recognize (Collections,
        // Playlists, People, ...) is left alone -- it has no chip of its
        // own, so a filter should never make it disappear.
        const type = sectionNativeType(section);
        if (!type) return;
        section.classList.toggle('section-hidden', !(activeTypes.size === 0 || activeTypes.has(type)));
    }

    function applyFilters() {
        const searchPage = document.querySelector('#searchPage:not(.hide)');
        if (!searchPage) return;
        searchPage.querySelectorAll('.verticalSection').forEach(applyFilterToSection);
    }

    function buildChipBar() {
        const bar = document.createElement('div');
        bar.id = BAR_ID;
        bar.className = 'je-search-filter-bar';
        TYPE_ORDER.forEach((type) => {
            const [key, fallback] = TYPE_LABEL_KEYS[type];
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'je-search-filter-chip';
            chip.textContent = t(key, fallback);
            chip.dataset.type = type;
            chip.addEventListener('click', () => {
                if (activeTypes.has(type)) {
                    activeTypes.delete(type);
                } else {
                    activeTypes.add(type);
                }
                chip.classList.toggle('je-search-filter-chip-active', activeTypes.has(type));
                applyFilters();
            });
            bar.appendChild(chip);
        });
        return bar;
    }

    function ensureChipBar() {
        const searchPage = document.querySelector('#searchPage:not(.hide)');
        if (!searchPage) return;
        if (document.getElementById(BAR_ID)) return;

        const input = searchPage.querySelector('#searchTextInput');
        if (!input) return;

        injectStyles();
        // Insert right after whatever wraps the search input, rather than
        // guessing at a specific class name for that wrapper -- the input
        // itself is the one thing every version of this page is guaranteed
        // to have (other code in this plugin already depends on it).
        const inputWrap = input.parentElement || searchPage;
        inputWrap.insertAdjacentElement('afterend', buildChipBar());
    }

    function removeChipBarIfSearchPageGone() {
        if (document.querySelector('#searchPage:not(.hide) #searchTextInput')) return;
        document.getElementById(BAR_ID)?.remove();
        activeTypes.clear();
    }

    function onSearchPageMutation() {
        ensureChipBar();
        removeChipBarIfSearchPageGone();
        applyFilters();
    }

    /**
     * Wires up the type-filter chip bar on Jellyfin's native search page.
     * Safe to call once at startup; re-attaches itself across SPA
     * navigation, same as music.js and jellyseerr.js do.
     */
    JE.initializeSearchTypeFilters = function() {
        if (!JE.pluginConfig?.JellyseerrEnabled) return;

        onSearchPageMutation();
        JE.core.dom.onBodyMutation('je-search-filters-attach', onSearchPageMutation);
        window.addEventListener('popstate', removeChipBarIfSearchPageGone);
        window.addEventListener('hashchange', removeChipBarIfSearchPageGone);
    };
})(window.JellyfinEnhanced);
