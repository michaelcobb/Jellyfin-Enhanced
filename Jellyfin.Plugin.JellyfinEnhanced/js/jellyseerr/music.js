// /js/jellyseerr/music.js
// Music search/discover/request: a "Discover Music on Seerr" row on
// Jellyfin's native search page (mirrors the movie/show row), a search-row
// card with hover-to-request, and an artist detail modal -- all backed by
// the Seerr music patch (see api.musicSearch/fetchMusicArtist/requestArtist
// in api.js, proxied server-side via jellyseerr/music/*).
//
// Deliberately NOT built on top of modal.js/item-details.js/the discovery
// sections: those are all structured around a single TMDB movie/TV item
// (poster, backdrop, season picker, profile/root-folder form) and have no
// music equivalent. The detail modal below instead reuses only the shared
// .je-more-info-modal shell/CSS with its own scoped state, so it carries no
// risk of breaking (or being broken by) upstream changes to the movie/TV
// request flow.
(function(JE) {
    'use strict';

    const STYLE_ID = 'je-music-styles';
    const MUSIC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

    function t(key, fallback) {
        const translated = typeof JE.t === 'function' ? JE.t(key) : key;
        return translated === key ? fallback : translated;
    }

    // Mirrors ui-cards.js's isSafeTmdbImagePath: artist.imageUrl is server
    // data (proxied from Fanart.tv), but it still gets interpolated into a
    // CSS url() below -- reject anything that isn't a plain https URL with
    // no quotes/parens that could break out of that context.
    function isSafeArtistImageUrl(url) {
        return typeof url === 'string' && /^https:\/\/[^\s"'()]+$/.test(url);
    }

    // The same "POSTER NOT FOUND" placeholder ui-cards.js falls back to for a
    // movie/show with no TMDB poster (ctx.posterNotFoundUrl), proxied through
    // the plugin's own CDN cache. Called lazily -- JE.cdn is set up by
    // plugin.js before any card renders, but not necessarily before this
    // file is first parsed.
    function noPosterUrl() {
        return JE.cdn?.url?.('ibb', 'fdbkXQdP/jellyseerr-poster-not-found.png') || '';
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID) || !document.head) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            /* Search-row cards reuse jellyseerr's own .jellyseerr-card /
               .jellyseerr-overview classes (ui-styles.js) so the hover
               mechanism, transitions and request-button styling are the
               exact ones movie/show cards use -- not a parallel copy. A
               missing artist photo falls back to the same "POSTER NOT
               FOUND" placeholder (noPosterUrl()) ui-cards.js uses for a
               movie/show with no TMDB poster, so no placeholder art of our
               own is needed here.
               Same .jellyseerr-media-badge chip ui-badges.js puts on movie/show
               posters (addMediaTypeBadge) -- only the colour is music-specific. */
            .jellyseerr-media-badge-music { background-color: #7c3aed; }
        `;
        document.head.appendChild(style);
    }

    /**
     * A Request button wired to JE.jellyseerrAPI.requestArtist, styled and
     * animated exactly like the movie/show cards' request button (same
     * classes/icons from jellyseerr's ui-icons.js/ui-styles.js). Used both
     * in the artist detail modal and directly on search-row cards, so the
     * two surfaces behave identically instead of duplicating this logic.
     * @param {string} mbid
     * @param {{alreadyAdded?: boolean}} [opts]
     * @returns {HTMLButtonElement}
     */
    function buildRequestButton(mbid, { alreadyAdded = false } = {}) {
        const icons = JE.jellyseerrUI?.icons || {};
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `jellyseerr-request-button ${alreadyAdded ? 'jellyseerr-button-pending' : 'jellyseerr-button-request'}`;
        btn.disabled = alreadyAdded;
        btn.innerHTML = alreadyAdded
            ? `${icons.pending || icons.requested || ''}<span>${t('music_requested_button', 'Already Requested')}</span>`
            : `${icons.request || ''}<span>${t('music_request_button', 'Request')}</span>`;

        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = `<span>${t('music_requesting', 'Requesting…')}</span><span class="jellyseerr-button-spinner"></span>`;
            try {
                await JE.jellyseerrAPI.requestArtist(mbid);
                btn.classList.remove('jellyseerr-button-request');
                btn.classList.add('jellyseerr-button-pending');
                btn.innerHTML = `${icons.pending || icons.requested || ''}<span>${t('music_requested_button', 'Already Requested')}</span>`;
                JE.toast(t('music_request_success', 'Artist requested!'), 3000);
            } catch (error) {
                console.error('🪼 Jellyfin Enhanced: Music: request failed:', error);
                btn.disabled = false;
                btn.innerHTML = `${icons.request || ''}<span>${t('music_request_button', 'Request')}</span>`;
                JE.toast(t('music_request_error', 'Something went wrong requesting this artist.'), 3000);
            }
        });

        return btn;
    }

    /**
     * The same small circular refresh control jellyseerr.js's
     * createJellyseerrSection puts beside the movie/show "Discover on Seerr"
     * heading -- same classes/icon/animation, so it looks and behaves
     * identically. Clicking it dispatches 'je-music-manual-refresh', our own
     * row's analogue of jellyseerr.js's 'jellyseerr-manual-refresh', rather
     * than reusing that event name (the handler it triggers re-renders the
     * movie row's .jellyseerr-section, not ours).
     * @returns {HTMLButtonElement}
     */
    function buildRefreshButton() {
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'jellyseerr-refresh-btn';
        refreshBtn.setAttribute('aria-label', t('music_refresh_button', 'Refresh'));
        refreshBtn.title = t('music_refresh_button', 'Refresh');
        refreshBtn.style.marginLeft = '0.5em';
        refreshBtn.style.verticalAlign = 'middle';
        refreshBtn.style.background = 'none';
        refreshBtn.style.border = 'none';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.style.display = 'inline-flex';
        refreshBtn.style.alignItems = 'center';
        refreshBtn.style.justifyContent = 'center';
        refreshBtn.style.padding = '0';
        const icon = document.createElement('span');
        icon.className = 'material-icons jellyseerr-refresh-icon';
        icon.textContent = 'refresh';
        icon.style.transition = 'transform 0.5s cubic-bezier(.4,2,.6,1)';
        refreshBtn.appendChild(icon);
        refreshBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            icon.style.transform = 'rotate(360deg)';
            setTimeout(() => { icon.style.transform = ''; }, 500);
            document.dispatchEvent(new CustomEvent('je-music-manual-refresh'));
        });
        // Same selectors/rules jellyseerr.js's section uses -- guarded by the
        // same style id so whichever row (movies or music) renders first is
        // the one that actually injects it; the second call is a no-op.
        if (!document.getElementById('jellyseerr-refresh-style')) {
            const style = document.createElement('style');
            style.id = 'jellyseerr-refresh-style';
            style.textContent = `
                .jellyseerr-refresh-btn:focus { outline: none; }
                .jellyseerr-refresh-icon { color: #fff; filter: opacity(0.6); }
                .jellyseerr-refresh-btn:hover .jellyseerr-refresh-icon { color: #fff; filter: opacity(0.9); }
            `;
            document.head.appendChild(style);
        }
        return refreshBtn;
    }

    // ================================
    // Artist "more info" modal
    // ================================
    // The movie/show "More Info" link opens JE.jellyseerrMoreInfo's modal --
    // a full detail page (backdrop, poster, stats panel, cast/crew) built
    // entirely around a TMDB id and TMDB-shaped data (seasons, ratings,
    // credits). Its open()/showModal() reach into that module's own
    // private `state`/`historyEntryActive` and call internal.renderActions,
    // internal.fetchMediaDetails, etc. -- all TMDB-specific and not meant to
    // be called with anything else, so there's no real "mechanism" there to
    // reuse for an artist beyond its *markup*: the .je-more-info-modal shell
    // and its CSS (more-info-modal-styles.js) make no assumption about what
    // data fills it in. This reuses that shell/CSS verbatim -- same classes,
    // same open/close choreography (backdrop click, Escape, X button, a
    // history entry so Back closes it) -- with its own scoped state, same
    // reasoning as the card hover mechanism above.
    let artistModal = null;
    let artistModalHistoryActive = false;
    let artistModalPopPending = false;

    function buildArtistModalContent(artist) {
        const metaParts = [artist.type, artist.country, artist.disambiguation].filter(Boolean);
        const backdropUrl = isSafeArtistImageUrl(artist.backgroundUrl) ? artist.backgroundUrl : '';
        const posterUrl = isSafeArtistImageUrl(artist.imageUrl) ? artist.imageUrl : noPosterUrl();
        const albums = artist.releaseGroups || [];
        const icons = JE.jellyseerrUI?.icons || {};
        // MusicBrainz's own community rating (0-5), only ever available from
        // this single-artist lookup -- never from search -- and sparse (most
        // artists have no votes), unlike a movie's TMDB score.
        const hasRating = typeof artist.rating === 'number';

        return `
            <div class="modal-overlay">
                <div class="modal-container">
                    <button class="modal-refresh" aria-label="${t('music_refresh_button', 'Refresh')}" title="${t('music_refresh_button', 'Refresh status')}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"></polyline>
                            <polyline points="1 20 1 14 7 14"></polyline>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36M20.49 15a9 9 0 0 1-14.85 3.36"></path>
                        </svg>
                    </button>
                    <button class="modal-close" aria-label="${t('music_close_button', 'Close')}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>

                    <div class="modal-backdrop"${backdropUrl ? ` style="background-image: url('${backdropUrl}');"` : ''}>
                        <div class="je-modal-backdrop-overlay"></div>
                    </div>

                    <div class="modal-content">
                        <div class="modal-main">
                            <div class="modal-left">
                                <div class="header-section">
                                    <div class="header-poster">
                                        <img src="${posterUrl}" alt="${JE.escapeHtml(artist.name)}" />
                                    </div>
                                    <div class="header-info">
                                        <div class="title-row">
                                            <h1 class="title">${JE.escapeHtml(artist.name)}</h1>
                                        </div>
                                        <div class="meta-info">
                                            ${metaParts.length
                                                ? metaParts.map((part) => `<span>${JE.escapeHtml(part)}</span>`).join('')
                                                : `<span>${t('music_card_overview', 'Discovered via MusicBrainz')}</span>`}
                                        </div>
                                        <div class="je-more-info-actions" data-mount="je-music-actions"></div>
                                    </div>
                                </div>

                                ${albums.length ? `
                                    <div class="cast-section">
                                        <h3>${t('music_discography', 'Discography')}</h3>
                                        <div class="cast-scroll">
                                            ${albums.map((rg) => `
                                                <div class="cast-member">
                                                    <div class="person-avatar">${MUSIC_ICON}</div>
                                                    <div class="person-name" title="${JE.escapeHtml(rg.title)}">${JE.escapeHtml(rg.title)}</div>
                                                    <div class="person-character">${rg.firstReleaseDate ? JE.escapeHtml(rg.firstReleaseDate.slice(0, 4)) : ''}</div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>

                            <div class="modal-right">
                                <div class="je-more-info-right-panel">
                                    <div class="je-more-info-stats-panel">
                                        ${hasRating ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_rating', 'Rating')}</div>
                                                <div class="je-more-info-stat-value">${icons.star || ''} ${artist.rating.toFixed(1)} / 5${artist.ratingVotes ? ` (${artist.ratingVotes})` : ''}</div>
                                            </div>
                                        ` : ''}
                                        ${artist.type ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_type', 'Type')}</div>
                                                <div class="je-more-info-stat-value">${JE.escapeHtml(artist.type)}</div>
                                            </div>
                                        ` : ''}
                                        ${artist.country ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_country', 'Country')}</div>
                                                <div class="je-more-info-stat-value">${JE.escapeHtml(artist.country)}</div>
                                            </div>
                                        ` : ''}
                                        ${artist.beginYear ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_formed', 'Formed')}</div>
                                                <div class="je-more-info-stat-value">${JE.escapeHtml(artist.beginYear)}${artist.endYear ? ` – ${JE.escapeHtml(artist.endYear)}` : ''}</div>
                                            </div>
                                        ` : ''}
                                        ${albums.length ? `
                                            <div class="je-more-info-stat-row">
                                                <div class="je-more-info-stat-label">${t('music_stat_albums', 'Albums')}</div>
                                                <div class="je-more-info-stat-value">${albums.length}</div>
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderArtistModalActions(modal, artist) {
        const mount = modal.querySelector('[data-mount="je-music-actions"]');
        if (!mount) return;
        mount.innerHTML = '';
        if (artist.canRequest) {
            mount.appendChild(buildRequestButton(artist.mbid, { alreadyAdded: artist.alreadyAdded }));
        } else {
            const note = document.createElement('span');
            note.className = 'je-more-info-stat-value';
            note.textContent = t('music_no_lidarr', 'No Lidarr server is configured.');
            mount.appendChild(note);
        }
    }

    function closeArtistModal() {
        artistModalHistoryActive = false;
        artistModalPopPending = false;
        if (!artistModal) return;
        const closing = artistModal;
        artistModal = null;
        closing.classList.remove('active');
        if (closing._jeCleanup) closing._jeCleanup();
        setTimeout(() => closing.remove(), 300);
    }

    function dismissArtistModal() {
        if (!artistModalHistoryActive) {
            closeArtistModal();
            return;
        }
        if (artistModalPopPending) return;
        artistModalPopPending = true;
        history.back();
    }

    window.addEventListener('popstate', () => {
        if (!artistModalHistoryActive) return;
        artistModalHistoryActive = false;
        artistModalPopPending = false;
        closeArtistModal();
    });

    async function openArtistModal(mbid) {
        injectStyles();
        const artist = await JE.jellyseerrAPI.fetchMusicArtist(mbid);
        if (!artist) {
            JE.toast?.(t('music_no_results', 'Could not load this artist.'), 3000);
            return;
        }

        if (artistModal) closeArtistModal();

        const modal = document.createElement('div');
        modal.className = 'je-more-info-modal';
        modal.innerHTML = buildArtistModalContent(artist);
        document.body.appendChild(modal);
        artistModal = modal;
        renderArtistModalActions(modal, artist);

        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('modal-overlay')) {
                dismissArtistModal();
            }
        });
        modal.querySelector('.modal-close')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissArtistModal();
        });
        modal.querySelector('.modal-refresh')?.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.classList.add('loading');
            btn.disabled = true;
            try {
                const fresh = await JE.jellyseerrAPI.fetchMusicArtist(mbid);
                if (artistModal !== modal) return; // closed/replaced while refreshing
                if (fresh) renderArtistModalActions(modal, fresh);
            } finally {
                btn.classList.remove('loading');
                btn.disabled = false;
            }
        });

        const handleEscape = (e) => { if (e.key === 'Escape') dismissArtistModal(); };
        document.addEventListener('keydown', handleEscape);
        modal._jeCleanup = () => document.removeEventListener('keydown', handleEscape);

        if (!artistModalHistoryActive) {
            history.pushState(null, '', location.href);
            artistModalHistoryActive = true;
        }

        requestAnimationFrame(() => modal.classList.add('active'));
    }

    // ================================
    // Native search-page integration
    // ================================
    // Mirrors jellyseerr.js's "Discover on Seerr" row for movies/shows, but
    // deliberately much simpler: no infinite scroll, pagination, or
    // collection lookups. MusicBrainz's first page of artist matches is
    // already a short, ranked list -- plenty for one horizontal row. Clicking
    // a card opens the detail modal below straight to that artist, reusing
    // all of its request logic rather than duplicating it inline in the row.
    const SEARCH_SECTION_ID = 'je-music-search-section';
    let searchRowDebounce = null;
    let searchRowAbort = null;

    function removeSearchRowSection() {
        const section = document.getElementById(SEARCH_SECTION_ID);
        if (!section) return;
        // Drop state for the cards leaving the DOM (musicCardStates is a
        // plain Map, not a WeakMap, since it's read from delegated listeners
        // that need to look cards up by element).
        section.querySelectorAll('.jellyseerr-card').forEach((card) => musicCardStates.delete(card));
        section.remove();
    }

    // ---- Card hover-to-request, the same mechanism ui-cards.js uses for
    // movie/show cards -----------------------------------------------------
    // Reviewed ui-cards.js: the Request button that appears on hover is NOT
    // a pre-built overlay whose opacity CSS toggles. `.jellyseerr-overview`
    // is always `opacity:1; pointer-events:auto` -- the overview element
    // itself doesn't exist in the DOM until createOverview() builds and
    // appends it (to .cardScalable) on mouseenter/focus/tap, and
    // removeOverview() deletes it again on mouseleave. The is-touch/
    // focus-within/hover CSS rules in ui-styles.js are vestigial for that
    // reason. Listeners are bound once per container (not per card), via
    // capture-phase mouseenter/mouseleave (they don't bubble) plus click/
    // keydown/touch. This mirrors that exactly, scoped to our own search
    // row and its own state, instead of hooking into ui-cards.js's private
    // cardStates/container set.
    const musicCardStates = new Map();
    const boundMusicContainers = new WeakSet();

    function createCardOverview(state) {
        const overview = document.createElement('div');
        overview.className = 'jellyseerr-overview';
        overview.style.cursor = 'default';
        overview.innerHTML = `<div class="content">${JE.escapeHtml([state.artist.type, state.artist.country].filter(Boolean).join(' · ') || t('music_card_overview', 'Discovered via MusicBrainz'))}</div>`;
        state.overview = overview;
        state.cardScalable.appendChild(overview);
        state.button = buildRequestButton(state.artist.mbid);
        overview.appendChild(state.button);
    }

    function removeCardOverview(state) {
        if (state.overview?.parentNode) state.overview.parentNode.removeChild(state.overview);
        state.overview = null;
        state.button = null;
    }

    function musicCardEventTarget(container, e) {
        const target = e.target;
        if (!(target instanceof Element)) return null;
        const card = target.closest('.jellyseerr-card');
        if (!card || card.parentElement !== container) return null;
        const state = musicCardStates.get(card);
        return state ? { card, state, target } : null;
    }

    function onMusicCardHoverBoundary(container, e, entering) {
        const target = e.target;
        if (!(target instanceof Element) || !target.classList.contains('cardScalable')) return;
        const hit = musicCardEventTarget(container, e);
        if (!hit || target !== hit.state.cardScalable) return;
        if (entering) {
            if (!hit.state.overview) createCardOverview(hit.state);
        } else {
            removeCardOverview(hit.state);
        }
    }

    function onMusicCardClick(container, e) {
        const hit = musicCardEventTarget(container, e);
        if (!hit) return;
        const { state, target } = hit;
        if (target.closest('.jellyseerr-request-button')) return; // its own listener handles this
        if (target.closest('.jellyseerr-overview')) {
            // Background of the open overview (not the button): mirrors
            // ui-cards.js's onOverviewClick, whose click-through on the
            // overview area opens the detail modal.
            e.preventDefault();
            e.stopPropagation();
            openArtistModal(state.artist.mbid);
            return;
        }
        if (target.closest('.jellyseerr-more-info-link')) {
            e.preventDefault();
            e.stopPropagation();
            openArtistModal(state.artist.mbid);
            return;
        }
        if (target.closest('.jellyseerr-poster-image') === state.imageContainer) {
            // Mirrors ui-cards.js's onPosterClick: show the overview (so a
            // keyboard/touch user still sees the Request button if the modal
            // is dismissed) and open the detail modal, same as a movie poster.
            e.preventDefault();
            e.stopPropagation();
            if (!state.overview) createCardOverview(state);
            openArtistModal(state.artist.mbid);
        }
    }

    function onMusicCardKeydown(container, e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const hit = musicCardEventTarget(container, e);
        if (!hit || hit.target.closest('.jellyseerr-poster-image') !== hit.state.imageContainer) return;
        e.preventDefault();
        if (!hit.state.overview) createCardOverview(hit.state);
        else removeCardOverview(hit.state);
    }

    function addDelegatedTapListener(container, onTap) {
        let startX = 0, startY = 0, moved = false;
        container.addEventListener('touchstart', (e) => {
            const t0 = e.touches[0];
            startX = t0.clientX; startY = t0.clientY; moved = false;
        }, { passive: true });
        container.addEventListener('touchmove', (e) => {
            const t0 = e.touches[0];
            if (Math.abs(t0.clientX - startX) > 10 || Math.abs(t0.clientY - startY) > 10) moved = true;
        }, { passive: true });
        container.addEventListener('touchend', (e) => {
            if (moved) return;
            const hit = musicCardEventTarget(container, e);
            if (hit && hit.target.closest('.jellyseerr-poster-image') === hit.state.imageContainer) onTap(hit.state);
        }, { passive: true });
    }

    function bindMusicCardContainer(container) {
        if (boundMusicContainers.has(container)) return;
        boundMusicContainers.add(container);
        container.addEventListener('click', (e) => onMusicCardClick(container, e));
        container.addEventListener('keydown', (e) => onMusicCardKeydown(container, e));
        container.addEventListener('mouseenter', (e) => onMusicCardHoverBoundary(container, e, true), true);
        container.addEventListener('mouseleave', (e) => onMusicCardHoverBoundary(container, e, false), true);
        addDelegatedTapListener(container, (state) => {
            if (!state.overview) createCardOverview(state);
        });
    }

    /**
     * Builds a search-row card with the exact markup/classes
     * createJellyseerrCard uses for movie/show cards (.jellyseerr-card,
     * .cardScalable, .cardImageContainer.jellyseerr-poster-image,
     * .cardOverlayContainer, .jellyseerr-more-info-link) so the shared
     * hover-to-request mechanism above and all of ui-styles.js's card CSS
     * apply unmodified. Only the poster art (an icon instead of a photo)
     * is music-specific.
     * @param {Object} artist
     * @returns {HTMLElement}
     */
    function buildSearchRowCard(artist) {
        const card = document.createElement('div');
        card.className = 'card overflowPortraitCard card-hoverable card-withuserdata jellyseerr-card';
        card.setAttribute('data-mbid', artist.mbid);
        const posterUrl = isSafeArtistImageUrl(artist.imageUrl) ? artist.imageUrl : noPosterUrl();
        // Seerr's /search now fans out to MusicBrainz's artist, album
        // (release-group), and song (recording) endpoints and resolves every
        // hit down to one artist-shaped result (see music.ts) -- the request
        // flow is still always "add this whole artist to Lidarr", so the
        // card is still one artist card either way. matchType says which
        // search actually found it; for an album/song match matchTitle is
        // the thing that matched, which is more useful here than the
        // artist's formation year (MusicBrainz's album/song search doesn't
        // return life-span, so beginYear is never set in that case anyway).
        const badgeText =
            artist.matchType === 'song' ? t('music_card_badge_song', 'Song') :
            artist.matchType === 'album' ? t('music_card_badge_album', 'Album') :
            t('music_card_badge', 'Artist');
        const metaText = artist.matchTitle || artist.beginYear || t('music_meta_na', 'N/A');
        card.innerHTML = `
            <div class="cardBox cardBox-bottompadded">
                <div class="cardScalable">
                    <div class="cardPadder cardPadder-overflowPortrait"></div>
                    <div class="cardImageContainer coveredImage cardContent jellyseerr-poster-image focusable" style="cursor: pointer; background-image: url('${posterUrl}');" tabindex="0">
                        <div class="jellyseerr-media-badge jellyseerr-media-badge-music">${JE.escapeHtml(badgeText)}</div>
                    </div>
                    <div class="cardOverlayContainer" style="pointer-events: none;"></div>
                </div>
                <div class="cardText cardTextCentered cardText-first">
                    <a is="emby-linkbutton" href="#" class="jellyseerr-more-info-link"><bdi>${JE.escapeHtml(artist.name)}</bdi></a>
                </div>
                <div class="cardText cardTextCentered cardText-secondary jellyseerr-meta">
                    <img class="jellyseerr-icon-on-card" src="${JE.cdn.selfhst('svg/seerr.svg')}" alt="Seerr">
                    <bdi>${JE.escapeHtml(metaText)}</bdi>
                </div>
            </div>
        `;

        const cardScalable = card.querySelector('.cardScalable');
        const imageContainer = card.querySelector('.jellyseerr-poster-image');
        musicCardStates.set(card, { artist, cardScalable, imageContainer, overview: null, button: null });

        return card;
    }

    function renderSearchRowSection(results) {
        removeSearchRowSection();
        if (!results.length) return;
        injectStyles();

        const searchPage = document.querySelector('#searchPage:not(.hide)');
        if (!searchPage) return;

        const section = document.createElement('div');
        section.id = SEARCH_SECTION_ID;
        section.className = 'verticalSection emby-scroller-container je-music-search-section';

        const title = document.createElement('h2');
        title.className = 'sectionTitle sectionTitle-cards focuscontainer-x padded-left padded-right';
        title.textContent = t('music_discover_title', 'Discover Music on Seerr');
        title.appendChild(buildRefreshButton());
        section.appendChild(title);

        const scroller = document.createElement('div');
        scroller.setAttribute('is', 'emby-scroller');
        scroller.className = 'padded-top-focusscale padded-bottom-focusscale emby-scroller';
        scroller.dataset.horizontal = 'true';
        scroller.dataset.centerfocus = 'card';

        const itemsContainer = document.createElement('div');
        itemsContainer.setAttribute('is', 'emby-itemscontainer');
        itemsContainer.className = 'focuscontainer-x itemsContainer scrollSlider';
        results.forEach((artist) => itemsContainer.appendChild(buildSearchRowCard(artist)));
        bindMusicCardContainer(itemsContainer);
        scroller.appendChild(itemsContainer);
        section.appendChild(scroller);

        // Good-enough placement: right after the movies/shows "Discover on
        // Seerr" section when it's there, otherwise at the end of the
        // results. Fighting Jellyfin's own React re-renders for exact
        // ordering against its native People/Studios rows isn't worth it.
        const jellyseerrSection = searchPage.querySelector('.jellyseerr-section');
        if (jellyseerrSection) {
            jellyseerrSection.after(section);
            return;
        }
        const resultsContainer = searchPage.querySelector('.searchResults, [class*="searchResults"], .padded-top.padded-bottom-page');
        (resultsContainer || searchPage).appendChild(section);
    }

    function runSearchRow(query, { skipCache = false } = {}) {
        if (searchRowAbort) searchRowAbort.abort();

        if (!query) {
            removeSearchRowSection();
            return;
        }

        searchRowAbort = new AbortController();
        const { signal } = searchRowAbort;

        JE.jellyseerrAPI.musicSearch(query, { signal, skipCache }).then((data) => {
            if (signal.aborted) return;
            renderSearchRowSection(data?.results || []);
        }).catch((error) => {
            if (error?.name === 'AbortError') return;
            console.error('🪼 Jellyfin Enhanced: Music: search-row failed:', error);
            removeSearchRowSection();
        });
    }

    function handleNativeSearchInput(event) {
        const query = (event.target.value || '').trim();
        clearTimeout(searchRowDebounce);
        searchRowDebounce = setTimeout(() => runSearchRow(query), 400);
    }

    function attachNativeSearchListener() {
        const input = document.querySelector('#searchPage #searchTextInput');
        if (!input || input.dataset.jeMusicAttached) return;
        input.dataset.jeMusicAttached = 'true';
        input.addEventListener('input', handleNativeSearchInput);
        if (input.value.trim()) runSearchRow(input.value.trim());
    }

    function cleanupIfSearchPageGone() {
        if (!document.querySelector('#searchPage:not(.hide) #searchTextInput')) {
            removeSearchRowSection();
        }
    }

    // Mirrors jellyseerr.js's own 'jellyseerr-manual-refresh' listener
    // (manualRefreshJellyseerrData), scoped to our row: re-run the row's
    // current query bypassing the cache instead of touching .jellyseerr-section.
    let manualRefreshListenerAttached = false;
    function attachManualRefreshListener() {
        if (manualRefreshListenerAttached) return;
        manualRefreshListenerAttached = true;
        document.addEventListener('je-music-manual-refresh', () => {
            const input = document.querySelector('#searchPage #searchTextInput');
            const query = (input?.value || '').trim();
            if (query) runSearchRow(query, { skipCache: true });
        });
    }

    /**
     * Wires up the "Discover Music on Seerr" row on Jellyfin's native search
     * page, alongside its existing movies/shows row. Safe to call once at
     * startup; re-attaches itself across SPA navigation.
     */
    JE.initializeMusicSearchSection = function() {
        if (!JE.pluginConfig?.JellyseerrEnabled) return;
        if (!JE.jellyseerrAPI?.musicSearch) return;

        attachNativeSearchListener();
        attachManualRefreshListener();
        JE.core.dom.onBodyMutation('je-music-search-attach', () => {
            attachNativeSearchListener();
            cleanupIfSearchPageGone();
        });
        window.addEventListener('popstate', cleanupIfSearchPageGone);
        window.addEventListener('hashchange', cleanupIfSearchPageGone);
    };
})(window.JellyfinEnhanced);
