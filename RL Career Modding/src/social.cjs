'use strict';

function installInteractions() {
  if (window.__rlcYInteractions) return 'already-installed';
  if ([typeof linkifyPost, typeof postHtml, typeof xWall, typeof xPeople, typeof xClubs, typeof xCreators]
    .some(type => type !== 'function')) return 'waiting-renderer';

  const strings = {
    en: ['Comments','Write a comment','Send','Reply','Hide replies','Show replies','No comments to show.','Copy text','Text copied.','Could not copy text.','Reposts','You reposted','Repost','Undo repost','Message','Write a message','Open a player profile to start a conversation.','Conversation','Action unavailable.'],
    fr: ['Commentaires','Écrire un commentaire','Envoyer','Répondre','Masquer les réponses','Afficher les réponses','Aucun commentaire consultable.','Copier le texte','Texte copié.','La copie a échoué.','Republications','Vous avez republié','Republier','Annuler la republication','Message','Écrire un message','Ouvre un profil pour envoyer un message.','Conversation','Action indisponible.'],
    de: ['Kommentare','Kommentar schreiben','Senden','Antworten','Antworten ausblenden','Antworten anzeigen','Keine Kommentare verfügbar.','Text kopieren','Text kopiert.','Kopieren fehlgeschlagen.','Geteilte Beiträge','Du hast diesen Beitrag geteilt','Teilen','Teilen rückgängig machen','Nachricht','Nachricht schreiben','Öffne ein Profil, um eine Nachricht zu senden.','Unterhaltung','Aktion nicht verfügbar.'],
    es: ['Comentarios','Escribe un comentario','Enviar','Responder','Ocultar respuestas','Mostrar respuestas','No hay comentarios disponibles.','Copiar texto','Texto copiado.','No se pudo copiar el texto.','Republicaciones','Has republicado','Republicar','Deshacer republicación','Mensaje','Escribe un mensaje','Abre un perfil para enviar un mensaje.','Conversación','Acción no disponible.'],
    pt: ['Comentários','Escreve um comentário','Enviar','Responder','Ocultar respostas','Mostrar respostas','Não há comentários disponíveis.','Copiar texto','Texto copiado.','Não foi possível copiar o texto.','Republicações','Republicaste','Republicar','Anular republicação','Mensagem','Escreve uma mensagem','Abre um perfil para enviar uma mensagem.','Conversa','Ação indisponível.'],
    ar: ['التعليقات','اكتب تعليقًا','إرسال','رد','إخفاء الردود','إظهار الردود','لا توجد تعليقات متاحة.','نسخ النص','تم نسخ النص.','تعذر نسخ النص.','إعادات النشر','أعدت النشر','إعادة النشر','إلغاء إعادة النشر','رسالة','اكتب رسالة','افتح ملف لاعب لإرسال رسالة.','محادثة','الإجراء غير متاح.']
  };
  function locale() {
    return typeof S === 'undefined' ? 'en' : (S?.lang || 'en').split('-')[0];
  }
  const tr = index => (strings[locale()] || strings.en)[index];
  const countText = count => typeof fmtCount === 'function' ? fmtCount(count) : String(count);
  const originalLinkify = linkifyPost;
  const originalPostHtml = postHtml;
  if (typeof threadPosts === 'function') {
    const originalThreadPosts = threadPosts;
    threadPosts = function (posts, ...args) {
      return originalThreadPosts.call(this, (posts || []).filter(post => post.replyTo == null), ...args);
    };
  }
  let directory;
  let handles;
  function profileKey(handle) {
    const accounts = [xPeople(), xClubs(), xCreators()];
    if (!directory || accounts.some((group, index) => group !== directory[index])) {
      directory = accounts;
      handles = new Map();
      accounts.forEach((group, index) => {
        for (const account of group) {
          if (!Number.isSafeInteger(account.id) || account.id < 0 || typeof account.handle !== 'string') continue;
          const name = account.handle.replace(/^@/, '').toLowerCase();
          const key = ['p', 'c', 'k'][index] + account.id;
          if (!handles.has(name)) handles.set(name, key);
          else if (handles.get(name) !== key) handles.set(name, null);
        }
      });
    }
    return handles.get(handle.toLowerCase());
  }

  linkifyPost = function (...args) {
    return originalLinkify.apply(this, args).replace(
      /<span class="x-mention">@([A-Za-z0-9_]+)<\/span>/g,
      (markup, handle) => {
        const key = profileKey(handle);
        return key ? '<button type="button" class="x-mention rlc-y-mention" data-action="x-profile" data-key="' +
          key + '">@' + handle + '</button>' : markup;
      });
  };

  let profileReposts = false;
  let savedReposts = null;
  let openComments = null;
  let loadedThread = null;
  if (typeof xProfileHtml === 'function' && typeof xTabsHtml === 'function') {
    const originalProfile = xProfileHtml;
    const originalTabs = xTabsHtml;
    xProfileHtml = function (key, ...args) {
      const own = key != null && key === xMeKey();
      if (!own) {
        const html = originalProfile.call(this, key, ...args);
        return /^p\d+$/.test(key) ? html.replace('<div class="xs-prof-btns">', '$&' +
          '<button type="button" class="xs-follow ghost rlc-y-dm" data-y-id="' + key.slice(1) + '">' + tr(14) + '</button>') : html;
      }
      xTabsHtml = function (items, active, attrs) {
        const profile = typeof attrs === 'string' && attrs.includes('x-prof-tab');
        return originalTabs.call(this, profile ? [...items, ['y-reposts', tr(10)]] : items, active, attrs);
      };
      try {
        const html = originalProfile.call(this, key, ...args);
        if (xProfTab !== 'y-reposts') return html;
        const posts = savedReposts || xWall().filter(post => Number.isSafeInteger(post.yRepostOf));
        profileReposts = true;
        const content = posts.length ? posts.map(post => postHtml(post)).join('') : '<p>' + tr(10) + ' (0)</p>';
        return html.replace(/<div class="xs-feed">[\s\S]*<\/div>$/, () => '<div class="xs-feed">' + content + '</div>');
      } finally {
        profileReposts = false;
        xTabsHtml = originalTabs;
      }
    };
  }

  postHtml = function (post, ...args) {
    if (Number.isSafeInteger(post.yRepostOf) && !profileReposts) return '';
    if (post.isReply || post.replyTo != null || !Number.isSafeInteger(post.id)) {
      return originalPostHtml.call(this, post, ...args);
    }
    const profilePosts = typeof S !== 'undefined' ? S?.social?.profileWall?.posts : null;
    const posts = [...xWall(), ...(profilePosts || [])];
    const isRepost = Number.isSafeInteger(post.yRepostOf);
    const original = isRepost ? posts.find(entry => entry.id === post.yRepostOf) : post;
    const target = original || post;
    let markup = originalPostHtml.call(this, target, ...args);
    const report = target.yMatch?.coordination;
    if (report) {
      const labels = {
        fr:['Coordination', 'Contrôle neutre', 'Biais actif', 'Aucune donnée du bot pour cette série',
            'équipe reconnue', 'équipe non reconnue', 'occasions relevées', 'priorités changées'],
        en:['Coordination', 'Neutral control', 'Active bias', 'No bot data for this series',
            'lineup matched', 'lineup mismatch', 'opportunities sampled', 'priority overrides']
      }[locale()] || ['Coordination', 'Neutral control', 'Active bias', 'No bot data for this series',
        'lineup matched', 'lineup mismatch', 'opportunities sampled', 'priority overrides'];
      const metrics = !report.coverage ? labels[3] :
        (report.matched ? labels[4] : labels[5]) + ' · ' + report.opportunities + ' ' + labels[6] +
        ' · ' + report.overrides + ' ' + labels[7];
      const form = target.yMatch.form;
      const formLabels = ({
        fr:['Pression', 'Fatigue', 'Synergie'],
        es:['Presión', 'Fatiga', 'Sinergia'],
        pt:['Pressão', 'Fadiga', 'Sinergia'],
        de:['Druck', 'Ermüdung', 'Synergie'],
        ar:['الضغط', 'الإرهاق', 'التناغم']
      })[locale()] || ['Pressure', 'Fatigue', 'Synergy'];
      const formLine = form ? Object.entries(form).map(([key, value]) => {
        const label = formLabels[['pressure', 'fatigue', 'cohesion'].indexOf(key)];
        return label && Number.isFinite(value) && value > 0 ? label + ' −' + value.toFixed(2) : '';
      }).filter(Boolean).join(' · ') : '';
      const convergenceLabel = ({
        fr:'convergences vers le ballon', de:'gleichzeitige Ballannäherungen', es:'aproximaciones simultáneas',
        pt:'aproximações simultâneas', ar:'اقترابات متزامنة من الكرة'
      })[locale()] || 'simultaneous approaches to the ball';
      const convergence = Number.isSafeInteger(report.convergences) ? ' · ' + report.convergences + ' ' + convergenceLabel : '';
      const line = labels[0] + ' · ' + labels[report.mode === 'neutral' ? 1 : 2] + ' · ' + metrics + convergence;
      markup = markup.replace('<div class="x-body">', () => '<div class="x-body"><div class="rlc-y-coordination">' +
        esc(line) + (formLine ? '<br>' + esc(formLine) : '') + '</div>');
    }
    const originalId = isRepost ? post.yRepostOf : post.id;
    const groups = new Map();
    const extras = loadedThread?.id === originalId && openComments === originalId ? loadedThread.posts : [];
    for (const entry of [...posts, ...extras]) {
      if (entry.replyTo == null || entry.id === originalId) continue;
      if (!groups.has(entry.replyTo)) groups.set(entry.replyTo, new Map());
      groups.get(entry.replyTo).set(entry.id, entry);
    }
    function replyForm(id, nested) {
      return '<form class="xc-foot rlc-y-reply-form" data-y-id="' + id + '" data-y-root="' + originalId + '"' +
        (nested ? ' hidden' : '') + '><input class="xc-input" placeholder="' + tr(1) + '" aria-label="' + tr(1) +
        '" maxlength="280" required><button class="xc-send" type="submit">' + tr(2) + '</button></form>';
    }
    let count = 0;
    function repostButton(target) {
      const reposted = Number.isSafeInteger(target.yRepostId);
      return '<button type="button" class="x-like rlc-y-action rlc-y-repost" data-y-id="' + target.id +
        '" aria-pressed="' + reposted + '" title="' + tr(reposted ? 13 : 12) + '">&#8635; ' +
        countText((target.reposts || 0) + Number(reposted)) + (reposted ? ' ✓' : '') + '</button>';
    }
    function branch(parent, depth, ancestors) {
      const children = groups.get(parent);
      if (!children || depth > 2) return '';
      return [...children.values()].filter(reply => !ancestors.has(reply.id)).map(reply => {
        count++;
        const nested = depth < 2 ? '<button type="button" class="xs-follow ghost sm rlc-y-nested-toggle">' +
          tr(3) + '</button>' + replyForm(reply.id, true) : '';
        const descendants = branch.call(this, reply.id, depth + 1, new Set([...ancestors, reply.id]));
        const card = originalPostHtml.call(this, { ...reply, isReply: false })
          .replace(/<span title="[^"]*">&#8635; [^<]*<\/span>/, () => repostButton(reply))
          .replace(/<span title="[^"]*">&#128172; [^<]*<\/span>/, '');
        const disclosure = descendants ? '<details open class="rlc-y-branch"><summary><span class="rlc-y-show">' +
          tr(5) + '</span><span class="rlc-y-hide">' + tr(4) + '</span></summary>' + descendants + '</details>' : '';
        return '<div class="rlc-y-reply-node">' + card + nested + disclosure + '</div>';
      }).join('');
    }
    const body = branch.call(this, originalId, 1, new Set([originalId])) || '<p>' + tr(6) + '</p>';
    const replyStat = /(<div class="x-actions">[\s\S]*?)<span title="[^"]*">&#128172; ([^<]*)<\/span>/;
    if (!replyStat.test(markup)) return markup;
    const reposted = isRepost || Number.isSafeInteger(post.yRepostId);
    const repostText = tr(reposted ? 13 : 12);
    const isOpen = openComments === originalId;
    const fixtureId = (original || post).yMatch?.fixtureId;
    const fixtureLabel = ({fr:'Voir le résultat',en:'See match result',es:'Ver resultado',pt:'Ver resultado',
      de:'Ergebnis ansehen',ar:'عرض نتيجة المباراة'})[locale()] || 'See match result';
    const matchButton = typeof openFullTime === 'function' && typeof fixtureOf === 'function' &&
      Number.isSafeInteger(fixtureId) && fixtureOf(fixtureId) ?
      '<button type="button" class="xs-follow ghost sm rlc-y-match" data-y-id="' + fixtureId + '">' + fixtureLabel + '</button>' : '';
    const activeLabel = reposted ? ' <span class="rlc-y-repost-check" aria-hidden="true">✓</span>' : '';
    const restoreControl = '<button type="button" class="x-like rlc-y-action rlc-y-repost" data-y-id="' + originalId +
      '" aria-pressed="' + reposted + '" title="' + repostText + '">&#8635; ' +
      ((original?.reposts ?? post.reposts ?? 0) + (reposted ? 1 : 0)) + activeLabel + '</button>';
    return markup.replace(replyStat, (_, actions) => actions +
      '<button type="button" class="x-like rlc-y-action rlc-y-comments-toggle" data-y-id="' + originalId +
        '" aria-expanded="' + isOpen + '" title="' + tr(0) + '">&#128172; ' +
      countText(Math.max(count, (original?.replies ?? post.replies ?? 0) + (original?.yReplyDelta ?? post.yReplyDelta ?? 0))) + '</button>').replace(/<span title="[^"]*">&#8635; [^<]*<\/span>/,
      restoreControl)
      .replace(/(<\/div>\s*<\/div>\s*<\/article>)$/, (_, closing) =>
        closing.replace('</div>', '</div><section class="rlc-y-comments"' + (isOpen ? '' : ' hidden') +
          '><strong>' + tr(0) + ' (' + count + ')</strong>' + body +
          replyForm(originalId, false) + '</section><div class="rlc-y-utilities">' + matchButton +
          '<button type="button" class="x-like rlc-y-action rlc-y-copy" data-y-id="' + originalId +
          '" title="' + tr(7) + '" aria-label="' + tr(7) + '">&#10697;</button></div>'))
      .replace(/(<div class="x-body">)/, isRepost ? '$1<div class="rlc-y-reposted">↻ ' + tr(11) + '</div>' : '$1');
  };

  let pending = false;
  async function action(kind, id, value, refresh = true, intent = 'auto') {
    if (pending) return null;
    pending = true;
    try {
      const result = await window.hub.toggleLike({ ySocial: kind, id, text: value, lang: locale(), intent });
      if (!result?.ok || !result.ySocialAction) {
        showToast(tr(18));
        return null;
      }
      if (Array.isArray(result.yReplies)) loadedThread = { id: result.yRoot ?? id, posts: result.yReplies };
      if (refresh && result.career) {
        S = result;
        render();
      }
      return result;
    } catch {
      showToast(tr(18));
      return null;
    } finally {
      pending = false;
    }
  }

  let privateChat = null;
  let privateContacts = [];
  const chatReady = typeof xChatHtml === 'function' && typeof xThreadHtml === 'function' &&
    typeof xMidHtml === 'function' && typeof xRailHtml === 'function';
  if (chatReady) {
    if (typeof xScreenHtml === 'function' && typeof xSideHtml === 'function') {
      const nativeScreen = xScreenHtml;
      const nativeSide = xSideHtml;
      xScreenHtml = function (...args) {
        const html = nativeScreen.apply(this, args);
        return xView === 'y-chat' ? html.replace(/class="xs( dark)?"/, (_, dark) => 'class="xs' +
          (dark || '') + ' chatting"') : html;
      };
      xSideHtml = function (...args) {
        return xView === 'y-chat' ? '' : nativeSide.apply(this, args);
      };
    }
    const nativeChat = xChatHtml;
    const nativeThread = xThreadHtml;
    const nativeMid = xMidHtml;
    const nativeRail = xRailHtml;
    xChatHtml = function (...args) {
      const rows = privateContacts.map(peer => {
        const selected = xView === 'y-chat' && privateChat?.id === peer.id;
        const avatar = typeof accountFaceHtml === 'function' ? accountFaceHtml({ kind: 'player', id: peer.id,
          name: peer.name, handle: peer.handle }, 'xc-face') : '';
        const date = peer.date && typeof fmtDateShort === 'function' ? fmtDateShort(peer.date) : '—';
        const preview = peer.preview || tr(17);
        return '<div class="xc-row rlc-y-dm' + (selected ? ' on' : '') + '" role="button" tabindex="0" aria-pressed="' +
          selected + '" data-y-id="' + peer.id + '">' + avatar +
          '<div class="xc-row-text"><div class="xc-row-top"><span class="xc-row-name">' + esc(peer.name) +
          '</span><span class="xc-row-when">' + esc(date) + '</span></div><div class="xc-row-prev">' +
          esc(preview) + '</div></div></div>';
      }).join('');
      const html = nativeChat.apply(this, args).replace('<div class="xc-rows">', () => '<div class="xc-rows">' + rows);
      return rows ? html.replace(/<div class="xc-none">[^<]*<\/div>/, '') : html;
    };
    xThreadHtml = function (...args) {
      if (xView !== 'y-chat') return nativeThread.apply(this, args);
      if (!privateChat) return '<div class="xc-empty">' + tr(16) + '</div>';
      const relationWords = {
        en: ['Trust','Morale','Strained','Neutral','Good','Support','Apology','Conflict'],
        fr: ['Confiance','Moral','Tendue','Neutre','Bonne','Soutien','Excuses','Conflit'],
        es: ['Confianza','Moral','Tensa','Neutral','Buena','Apoyo','Disculpa','Conflicto'],
        pt: ['Confiança','Moral','Tensa','Neutra','Boa','Apoio','Desculpa','Conflito'],
        de: ['Vertrauen','Moral','Angespannt','Neutral','Gut','Unterstützung','Entschuldigung','Konflikt'],
        ar: ['الثقة','المعنويات','متوترة','محايدة','جيدة','دعم','اعتذار','خلاف']
      };
      const words = relationWords[locale()] || relationWords.en;
      const draftLabels = {
        en:['Plain','Respect','Thanks','Joke','Hype','Cocky','Callout','Apology'],
        fr:['Simple','Respect','Merci','Blague','Encourager','Confiant','Reproche','Excuses'],
        es:['Normal','Respeto','Gracias','Broma','Ánimo','Confianza','Reproche','Disculpa'],
        pt:['Normal','Respeito','Obrigado','Piada','Incentivo','Confiante','Repreensão','Desculpa'],
        de:['Neutral','Respekt','Danke','Witz','Anfeuern','Selbstbewusst','Vorwurf','Entschuldigung'],
        ar:['عادي','احترام','شكر','مزاح','تشجيع','ثقة','عتاب','اعتذار']
      };
      const labels = draftLabels[locale()] || draftLabels.en;
      const tones = '<div class="ux-thr-row rlc-y-dm-tones' + (window.__uxThreadUI ? '' : ' fallback') + '" role="group">' +
        labels.map((label, index) => '<button type="button" class="ux-thr-chip rlc-y-dm-tone' + (index === 0 ? ' on' : '') +
          '" data-y-tone="' + index + '" aria-pressed="' + (index === 0) + '">' + esc(label) + '</button>').join('') +
        '</div>';
      const signed = value => (value >= 0 ? '+' : '−') + Math.abs(value);
      function feedback(effect) {
        if (!effect || !Number.isFinite(effect.trustDelta)) return '';
        const label = words[{ support:5, apology:6, conflict:7 }[effect.kind]] || words[0];
        const morale = effect.moraleDelta ? ' · ' + words[1] + ' ' + signed(effect.moraleDelta) : '';
        return '<div class="xc-when rlc-y-dm-effect">' + esc(label + ' · ' + words[0] + ' ' +
          signed(effect.trustDelta) + morale) + '</div>';
      }
      const relationship = privateChat.yRelationship;
      function meter(label, score, descriptor, kind) {
        const amount = Math.round(Math.min(100, Math.max(0, Number(score) || 0)));
        const level = amount < 41 ? 'low' : amount > 60 ? 'high' : 'middle';
        return '<div class="rlc-y-meter ' + kind + ' ' + level + '"><div class="rlc-y-meter-head">' +
          '<span>' + esc(label) + '</span><span class="rlc-y-meter-value">' + amount +
          '<small>/100</small></span></div><div class="rlc-y-meter-track" role="meter" aria-label="' + esc(label) +
          '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + amount + '"><i style="--level:' + amount +
          '%"></i></div>' + (descriptor ? '<div class="rlc-y-meter-label">' + esc(descriptor) + '</div>' : '') + '</div>';
      }
      const status = relationship ? '<div class="rlc-y-relationship">' +
        meter(words[0], relationship.trust, words[relationship.trust < 41 ? 2 : relationship.trust > 60 ? 4 : 3], 'trust') +
        (relationship.teammate ? meter(words[1], relationship.morale, '', 'morale') : '') + '</div>' : '';
      const messages = privateChat.yMessages.map(message => '<div class="xc-msg' + (message.mine ? ' mine' : '') +
        '"><div class="xc-bubble">' + linkifyPost(message.text) + '</div>' + feedback(message.effect) +
        (message.relationReason || message.noRelationChange ? '<div class="xc-when">' + esc(({
          repeated: { en:'This tone already affected your relationship today.', fr:'Ce ton a déjà affecté la relation aujourd’hui.',
            es:'Este tono ya afectó a la relación hoy.', pt:'Este tom já afetou a relação hoje.',
            de:'Dieser Ton hat die Beziehung heute schon beeinflusst.', ar:'أثرت هذه النبرة على العلاقة اليوم بالفعل.' },
          'daily-limit': { en:'Daily relationship limit reached.', fr:'Plafond de relation atteint pour la journée.',
            es:'Límite diario de relación alcanzado.', pt:'Limite diário da relação atingido.',
            de:'Tageslimit der Beziehung erreicht.', ar:'تم بلوغ الحد اليومي للعلاقة.' },
          'no-tension': { en:'No tension to repair.', fr:'Pas de tension à apaiser.',
            es:'No hay tensión que resolver.', pt:'Não há tensão para resolver.',
            de:'Es gibt keine Spannung abzubauen.', ar:'لا يوجد توتر يحتاج إلى إصلاح.' }
        })[message.relationReason]?.[locale()] || ({en:'No change to the relationship.',fr:'Aucun changement de la relation.',
          es:'Sin cambios en la relación.',pt:'A relação não mudou.',de:'Keine Änderung der Beziehung.',ar:'لا تغيير في العلاقة.'})[locale()] ||
          'No change to the relationship.') + '</div>' : '') +
        (message.date && typeof fmtDateShort === 'function' ? '<div class="xc-when">' + esc(fmtDateShort(message.date)) + '</div>' : '') + '</div>').join('');
      const peer = privateChat.yPeer;
      const face = typeof accountFaceHtml === 'function' ?
        accountFaceHtml({ kind: 'player', id: privateChat.id, name: peer, handle: privateChat.yHandle }, 'xc-head-face') : '';
      return '<div class="xc-top">' + face + '<div class="xc-top-name">' + esc(peer) +
        '</div><button class="xs-follow ghost sm" data-action="x-profile" data-key="p' + privateChat.id + '">' +
        (typeof tl === 'function' ? tl('View profile') : 'View profile') + '</button></div>' + status + '<div class="xc-body rlc-y-chat-history">' +
        messages + '</div><form class="xc-foot rlc-y-dm-form" data-y-id="' + privateChat.id +
        '"><input type="hidden" name="intent" value="auto">' + tones +
        '<div class="rlc-y-dm-input-row"><input class="xc-input" name="message" aria-label="' + tr(15) +
        '" placeholder="' + tr(15) + '" maxlength="400" required><button type="submit" class="xc-send">' + tr(2) + '</button></div></form>';
    };
    xMidHtml = function (...args) {
      return xView === 'y-chat' ? xChatHtml() : nativeMid.apply(this, args);
    };
    xRailHtml = function (...args) {
      const html = nativeRail.apply(this, args);
      if (!html.includes('data-view="chat"')) {
        return html.replace('</nav>', '<button type="button" class="xs-nav rlc-y-open-chat">Chat</button></nav>');
      }
      return xView === 'y-chat' ? html.replace('class="xs-nav" data-action="x-go" data-view="chat"',
        'class="xs-nav on" data-action="x-go" data-view="chat"') : html;
    };
  }

  function showPrivateChat() {
    xView = 'y-chat';
    render();
    const view = document.querySelector('.rlc-y-chat-history');
    if (view) view.scrollTop = view.scrollHeight;
  }

  async function refreshPrivateContacts() {
    const result = await action('dm-list', 0, '', false);
    if (result) privateContacts = result.yContacts;
  }

  async function openDm(id) {
    if (!chatReady) return;
    const result = await action('dm-read', id, '', false);
    if (!result) return;
    privateChat = { ...result, id };
    await refreshPrivateContacts();
    showPrivateChat();
  }

  document.addEventListener('keydown', event => {
    const row = event.target.closest?.('.xc-row.rlc-y-dm');
    if (!row || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    row.click();
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.matches('.rlc-y-dm-form')) {
      event.preventDefault();
      const id = Number(form.dataset.yId);
      const sent = await action('dm-send', id, form.querySelector('[name="message"]').value, false, form.querySelector('[name="intent"]')?.value);
      if (sent) {
        if (sent.career) S = sent;
        privateChat = { ...sent, id };
        await refreshPrivateContacts();
        showPrivateChat();
      }
      return;
    }
    if (!form.matches('.rlc-y-reply-form')) return;
    event.preventDefault();
    const id = Number(form.dataset.yId);
    if (!Number.isSafeInteger(id)) return;
    openComments = Number(form.dataset.yRoot);
    await action('reply', id, form.querySelector('input').value);
  });

  const draftText = {
    en:['Hey, how are you doing?', 'I respect the work you put in today.', 'Thanks for having my back today.', 'Think the ball owes us an apology.', 'We’ve got the next one. Let’s go!', 'I’m feeling good about our next series.', 'You cost us that game. We need to talk.', 'Sorry for how I spoke to you.'],
    fr:['Salut, comment ça va ?', 'Je respecte le travail que tu as fait aujourd’hui.', 'Merci de m’avoir couvert aujourd’hui.', 'Je crois que le ballon nous doit des excuses.', 'On prend la prochaine. Allez !', 'Je le sens bien pour la prochaine série.', 'Tu nous as fait perdre. Il faut qu’on en parle.', 'Désolé de t’avoir parlé comme ça.'],
    es:['Hola, ¿qué tal?', 'Respeto tu esfuerzo de hoy.', 'Gracias por cubrirme hoy.', 'Creo que el balón nos debe una disculpa.', '¡Vamos a por la siguiente!', 'Me siento bien para la próxima serie.', 'Nos costaste el partido. Tenemos que hablar.', 'Perdón por cómo te hablé.'],
    pt:['Olá, como estás?', 'Respeito o teu esforço de hoje.', 'Obrigado por me cobrires hoje.', 'Acho que a bola nos deve um pedido de desculpas.', 'Vamos ganhar a próxima!', 'Estou confiante para a próxima série.', 'Fizeste-nos perder. Temos de falar.', 'Desculpa pela forma como falei contigo.'],
    de:['Hey, wie geht es dir?', 'Ich respektiere deinen Einsatz heute.', 'Danke, dass du mich heute abgesichert hast.', 'Der Ball schuldet uns wohl eine Entschuldigung.', 'Das nächste holen wir uns!', 'Ich bin zuversichtlich für die nächste Serie.', 'Du hast uns das Spiel gekostet. Wir müssen reden.', 'Entschuldige, wie ich mit dir geredet habe.'],
    ar:['مرحبًا، كيف حالك؟','أحترم جهدك اليوم.','شكرًا لأنك ساندتني اليوم.','أظن أن الكرة مدينة لنا باعتذار.','سنفوز بالمباراة القادمة!','أنا واثق قبل السلسلة القادمة.','تسببت في خسارتنا. علينا أن نتحدث.','آسف على الطريقة التي تحدثت بها معك.']
  };
  document.addEventListener('click', async event => {
    const toneButton = event.target.closest?.('.rlc-y-dm-tone');
    if (toneButton) {
      const form = toneButton.closest('.rlc-y-dm-form');
      const index = Number(toneButton.dataset.yTone);
      const drafts = draftText[locale()] || draftText.en;
      if (!form || !drafts[index]) return;
      const field = form.querySelector('[name="message"]');
      field.value = drafts[index];
      form.querySelector('[name="intent"]').value = ['auto','respect','thanks','joke','hype','cocky','conflict','apology'][index];
      for (const option of form.querySelectorAll('.rlc-y-dm-tone')) {
        const active = option === toneButton;
        option.classList.toggle('on', active);
        option.setAttribute('aria-pressed', String(active));
      }
      field.focus();
      field.setSelectionRange?.(field.value.length, field.value.length);
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches && typeof field.animate === 'function') {
        field.getAnimations?.().forEach(animation => animation.cancel());
        field.animate([{ opacity: 0.35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 180, easing: 'cubic-bezier(.2,.7,.25,1)' });
      }
      return;
    }
    const nested = event.target.closest?.('.rlc-y-nested-toggle');
    if (nested) {
      const form = nested.nextElementSibling;
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('input').focus();
      return;
    }
    if (event.target.closest?.('.rlc-y-open-chat')) {
      await refreshPrivateContacts();
      showPrivateChat();
      return;
    }
    if (event.target.closest?.('[data-action="x-go"][data-view="chat"]')) {
      await refreshPrivateContacts();
      if (xView === 'chat') render();
      return;
    }
    if (event.target.closest?.('[data-action="x-prof-tab"][data-view="y-reposts"]')) {
      savedReposts = null;
      const result = await action('reposts-list', 0, '', false);
      if (result) {
        savedReposts = result.yReposts;
        render();
      }
      return;
    }
    const button = event.target.closest?.('.rlc-y-action,.rlc-y-dm,.rlc-y-match');
    if (!button) return;
    const id = Number(button.dataset.yId);
    if (!Number.isSafeInteger(id)) return;
    if (button.classList.contains('rlc-y-match')) {
      if (typeof openFullTime === 'function' && typeof fixtureOf === 'function' && fixtureOf(id)) openFullTime(id);
      return;
    }
    if (button.classList.contains('rlc-y-dm')) {
      await openDm(id);
      return;
    }
    if (button.classList.contains('rlc-y-comments-toggle')) {
      const section = button.closest('.x-post')?.querySelector('.rlc-y-comments');
      if (!section) return;
      section.hidden = !section.hidden;
      openComments = section.hidden ? null : id;
      button.setAttribute('aria-expanded', String(!section.hidden));
      if (openComments !== null) await action('comments', id);
      return;
    }
    if (button.classList.contains('rlc-y-copy')) {
      const post = [...xWall(), ...(S?.social?.profileWall?.posts || []), ...(savedReposts || [])]
        .find(entry => entry.id === id || entry.yRepostOf === id);
      if (typeof post?.text !== 'string') return;
      try {
        await navigator.clipboard.writeText(post.text);
        showToast(tr(8));
      } catch {
        showToast(tr(9));
      }
      return;
    }
    savedReposts = null;
    await action('repost', id);
  });

  const styles = document.createElement('style');
  styles.textContent = '.rlc-y-mention,.rlc-y-comments-toggle{appearance:none;background:none;border:0;padding:0;font:inherit;cursor:pointer}' +
    '.rlc-y-mention:hover{text-decoration:underline}.x-like.rlc-y-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:auto;min-width:0;height:auto;min-height:0;padding:4px 7px;color:inherit;border:0;border-radius:999px;background:transparent;text-decoration:none}' +
    '.x-like.rlc-y-action:hover{color:inherit;background:rgba(128,128,128,.15)}' +
    '.x-like.rlc-y-action:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +

    '.rlc-y-utilities{position:static;display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;clear:both}' +
    '.x-like.rlc-y-copy{position:static;inset:auto;transform:none;display:inline-flex;align-items:center;justify-content:center;padding:3px 7px;line-height:1}' +
    '.rlc-y-reply-node{margin:6px 0 6px 9px;padding-left:8px;border-left:1px solid color-mix(in srgb,currentColor 16%,transparent)}' +
    '.rlc-y-reply-form[hidden]{display:none}.rlc-y-nested-toggle{margin:2px 0 6px;font:inherit}' +
    '.rlc-y-repost-check{font-weight:bold}.rlc-y-reply-form,.rlc-y-dm-form{display:flex;gap:8px;margin-top:8px}' +
    '.rlc-y-reply-form .xc-input,.rlc-y-dm-form .xc-input{flex:1;min-width:0}.rlc-y-dm-form{flex-direction:column;align-items:stretch}.rlc-y-dm-input-row{display:flex;gap:8px}' +
    '.rlc-y-dm-tones{display:flex;flex-wrap:wrap;gap:6px;margin:0}.rlc-y-dm-tone{white-space:nowrap}' +
    'body .rlc-y-dm-tones.fallback .rlc-y-dm-tone{border-radius:999px;padding:4px 13px;font:inherit;font-size:var(--f-small,.78rem);font-weight:700;border:1px solid var(--rule,#8885);color:var(--text,inherit);background:transparent;cursor:pointer}' +
    'body .rlc-y-dm-tones.fallback .rlc-y-dm-tone.on{background:var(--text,#252525);color:var(--panel,Canvas);border-color:transparent}' +
    '.rlc-y-chat-history{min-height:0;overflow:auto}.rlc-y-dm-form{width:100%}.rlc-y-dm-effect{font-weight:600}' +
    '.rlc-y-relationship{flex:0 0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px;padding:9px 16px 10px;margin:0;border-bottom:1px solid var(--rule,#8885);background:var(--panel,transparent)}' +
    '.rlc-y-meter{--meter:#8493a0;min-width:0}.rlc-y-meter.low{--meter:#d36e66}.rlc-y-meter.high{--meter:#56a888}.rlc-y-meter.morale.middle{--meter:#c09b60}' +
    '.rlc-y-meter-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-weight:700}.rlc-y-meter-value{font-variant-numeric:tabular-nums;font-size:1.2em}' +
    '.rlc-y-meter-value small,.rlc-y-meter-label{font-weight:500;opacity:.75;font-size:.82em}.rlc-y-meter-track{height:5px;margin:4px 0;background:var(--rule,#8885);border-radius:5px;overflow:hidden}' +
    '.rlc-y-meter-track i{display:block;width:var(--level);height:100%;background:var(--meter);border-radius:inherit}' +
    '.xc-row.rlc-y-dm{width:100%;box-sizing:border-box}.xc-row.rlc-y-dm.on{background:color-mix(in srgb,currentColor 14%,transparent)}' +
    '.rlc-y-reposted,.rlc-y-coordination{opacity:.75;font-size:.85em;margin-bottom:4px}' +
    '.rlc-y-comments[hidden]{display:none}.rlc-y-comments{margin-top:10px;padding:10px 0 0;border:0;border-top:1px solid color-mix(in srgb,currentColor 16%,transparent)}' +
    '.rlc-y-branch[open]>.rlc-y-hide,.rlc-y-branch[open]>summary .rlc-y-show,.rlc-y-branch:not([open])>summary .rlc-y-hide{display:none}';
  document.head.appendChild(styles);
  const synergyPanels = new WeakSet();
  if (typeof MutationObserver === 'function') {
    const observeSynergy = new MutationObserver(async () => {
      const panel = document.querySelector('.ux-club-page:not(.ux-ev) .ux-chem')?.parentElement;
      const meter = document.querySelector('.ux-synrow > .meter-wrap:last-child');
      const targets = [panel, meter].filter(node => node && !synergyPanels.has(node));
      if (!targets.length || pending) return;
      targets.forEach(node => synergyPanels.add(node));
      const result = await action('squad-relations', 0, '', false);
      const squad = result?.ySquad;
      if (!squad?.active || squad.score == null) return;
      const labels = {
        en:'Trust in your core lineup', fr:'Confiance dans ton trio', de:'Vertrauen im Kernteam',
        es:'Confianza en tu trío', pt:'Confiança no teu trio', ar:'الثقة في التشكيلة الأساسية'
      };
      const synergy = {en:'Lineup synergy',fr:'Synergie du trio',de:'Team-Synergie',es:'Sinergia del trío',pt:'Sinergia do trio',ar:'تناغم الفريق'};
      const chemistry = squad.chemistry;
      const signed = value => (value < -0.05 ? '−' : value > 0.05 ? '+' : '±') + Math.abs(value).toFixed(1);
      for (const target of targets.filter(node => node.isConnected)) {
        if (chemistry?.penalty > 0) {
          const rating = target.querySelector('.ux-chem .ux-big strong, .meter-value');
          if (rating) rating.textContent = signed(chemistry.value);
          const big = target.querySelector('.ux-chem .ux-big');
          big?.classList.toggle('neg', chemistry.value < -0.05);
          big?.classList.toggle('pos', chemistry.value > 0.05);
          const fill = target.querySelector('.meter-fill');
          if (fill) fill.style.width = Math.round(Math.max(0, Math.min(1, (chemistry.value + 3) / 5.5)) * 100) + '%';
        }
        const summary = document.createElement('div');
        summary.className = 'ux-cm rlc-y-squad-trust';
        const modifier = chemistry ? signed(-chemistry.penalty) : String(100 - (squad.penalty || 0)) + '/100';
        summary.textContent = (synergy[locale()] || synergy.en) + ' ' + modifier + ' · ' +
          (labels[locale()] || labels.en) + ' ' + squad.score + '/100';
        target.appendChild(summary);
      }
    });
    observeSynergy.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.__rlcYInteractions = true;
  return 'installed';
}

function installPostEngagement(engine, getLanguage) {
  if (typeof engine?.postTweet !== 'function' || typeof engine.handleFor !== 'function') return 'waiting-engine';
  if (engine.postTweet.rlcYEngagement) return 'already-installed';
  const original = engine.postTweet;
  function postWithEngagement(state, ...args) {
    const result = original.call(this, state, ...args);
    if (!result?.ok) return result;
    const social = state.social;
    const post = social?.posts?.find(entry => entry.id === result.id && entry.own);
    if (!post?.target) return result;

    for (const key of ['views', 'likes', 'reposts', 'replies']) {
      const target = Math.round(post.target[key] * 1.25);
      post.target[key] = target;
      post[key] = Math.round(target * 0.30);
    }

    // One reply per mentioned player per career day, including posts moved to the archive.
    const mentioned = new Set(Array.from(String(post.text).matchAll(/(?:^|[^\w@])@([a-z0-9_]+)/gi),
      match => match[1].toLowerCase()));
    if (mentioned.size === 0 || !Array.isArray(state.players) || !Number.isSafeInteger(state.nextId)) return result;
    const players = state.players.filter(player => player.id !== post.authorId && player.name &&
      Number.isSafeInteger(player.id) && player.id >= 0 && mentioned.has(engine.handleFor(player.name).toLowerCase()));
    const used = new Set([...social.posts, ...(social.archive || [])].filter(entry =>
      entry.ySocialReply && entry.date === post.date).map(entry => entry.authorId));
    const responder = players.find(player => !used.has(player.id) && players.filter(other =>
      engine.handleFor(other.name) === engine.handleFor(player.name)).length === 1);
    if (!responder) return result;
    const teammate = responder.teamId >= 0 && responder.teamId === state.userTeamId;
    const fame = Math.log10(1 + (responder.followers || 0));
    const userFame = Math.log10(1 + (post.followers || 0));
    const ego = typeof engine.egoOf === 'function' ? engine.egoOf(responder) : 1;
    const chance = Math.max(0.10, Math.min(0.92, 0.72 + (userFame - fame) * 0.11 - (ego - 1) * 0.12));
    if (!teammate && ((Math.imul(post.id, 2654435761) ^ responder.id) >>> 0) / 4294967296 >= chance) return result;

    const mood = responder.morale ?? 72;
    const messages = mood >= 70 ? ['Merci pour la mention !', 'J’ai vu passer ton post. Ça fait plaisir !',
      'Bien vu, merci d’avoir pensé à moi.', 'Je viens de voir ça, merci !'] :
      mood >= 45 ? ['J’ai vu la mention, merci.', 'Bien reçu.', 'Merci pour le message.'] :
      ['Vu.', 'OK.', 'Pas grand-chose à ajouter.'];
    const language = typeof getLanguage === 'function' ? getLanguage() : 'fr';
    const localized = {
      en: ['Thanks for the mention!', 'Just saw the post, cheers.', 'Seen.'],
      es: ['¡Gracias por mencionarme!', 'Acabo de ver el mensaje, gracias.', 'Visto.'],
      de: ['Danke fürs Erwähnen!', 'Den Beitrag habe ich gesehen, danke.', 'Gesehen.'],
      pt: ['Obrigado pela menção!', 'Vi a publicação, obrigado.', 'Visto.'],
      ar: ['شكرًا على الإشارة!', 'رأيت المنشور، شكرًا.', 'تمت القراءة.']
    };
    const translated = localized[language];
    const text = translated ? translated[mood >= 70 ? 0 : mood >= 45 ? 1 : 2] : messages[post.id % messages.length];
    const reply = {
      id: state.nextId++, date: post.date, kind: 'player', authorId: responder.id,
      name: responder.name, handle: engine.handleFor(responder.name), followers: responder.followers || 0,
      text: '@' + post.handle + ' ' + text, replyTo: post.id,
      views: 0, likes: 0, reposts: 0, replies: 0, ySocialReply: true
    };
    // Keep the base game's timeline limit and archive order.
    social.posts.unshift(reply);
    const cap = engine.TIMELINE_MAX || 220;
    if (social.posts.length > cap) {
      if (!Array.isArray(social.archive)) social.archive = [];
      social.archive.unshift(...social.posts.splice(cap));
    }
    post.replies = Math.max(1, post.replies);
    post.target.replies = Math.max(1, post.target.replies);
    return result;
  }
  postWithEngagement.rlcYEngagement = true;
  engine.postTweet = postWithEngagement;
  return 'installed';
}

function installReposts(engine, relationships) {
  if (typeof engine?.toggleLike !== 'function') return 'waiting-engine';
  if (engine.toggleLike.rlcYReposts) return 'already-installed';
  const toggleLike = engine.toggleLike;
  const error = message => ({ ok: false, error: message });
  const success = extra => ({ ok: true, ySocialAction: true, ...extra });
  function roll(seed) {
    let number = 2166136261;
    for (const character of String(seed)) number = Math.imul(number ^ character.charCodeAt(0), 16777619);
    return (number >>> 0) / 4294967296;
  }
  function replyChance(state, player, extra = 0) {
    const user = state.players?.find(entry => entry.id === state.userPlayerId);
    const fameGap = Math.log10(1 + (user?.followers || 0)) - Math.log10(1 + (player.followers || 0));
    const ego = typeof engine.egoOf === 'function' ? engine.egoOf(player) : 1;
    return Math.max(0.08, Math.min(0.95, 0.61 + fameGap * 0.13 - (ego - 1) * 0.17 + extra));
  }
  function tone(player) {
    const morale = player.morale ?? 72;
    return morale >= 70 ? 'warm' : morale >= 45 ? 'neutral' : 'cold';
  }
  const responseBank = {
    win: {
      warm: ['Bien joué aussi ! On continue comme ça.', 'Ça fait plaisir après tout le travail de la semaine.', 'On a bien géré les moments chauds.', 'On garde ce rythme pour le prochain match.'],
      neutral: ['GG, on passe à la suite.', 'Un bon résultat. À confirmer au prochain match.', 'C’était solide dans l’ensemble.', 'Le score fait du bien.'],
      cold: ['GG.', 'Bien joué.', 'On verra le prochain.', 'C’est fait.']
    },
    loss: {
      warm: ['Dur à encaisser, mais on peut rebondir.', 'On va regarder le replay et corriger ça.', 'Ça arrive. On se remet au travail ensemble.', 'On a de quoi faire mieux au prochain match.'],
      neutral: ['Il faut passer au prochain match.', 'Il y a des choses à revoir.', 'On en reparlera après le replay.', 'On n’a pas été assez réguliers.'],
      cold: ['Match à oublier.', 'Pas envie d’en parler.', 'On fera le point plus tard.', 'OK.']
    },
    roster: {
      warm: ['Hâte de voir ce que ça donne dans le roster.', 'J’espère que le groupe trouvera vite ses repères.', 'Ça va être intéressant à suivre.', 'J’ai envie de voir comment l’équipe va travailler ensemble.'],
      neutral: ['On verra comment ça prend.', 'Attendons de voir les premières séries.', 'Ça dépendra du rôle que chacun prend.', 'Le terrain donnera la réponse.'],
      cold: ['À voir.', 'Trop tôt.', 'Pas de commentaire.', 'Je préfère attendre.']
    },
    question: {
      warm: ['Bonne question. Je vais y réfléchir !', 'Je n’ai pas la réponse maintenant, mais on en reparle.', 'Je vais y penser. Qu’est-ce que tu en dis ?', 'On pourrait en parler après l’entraînement.'],
      neutral: ['Je ne sais pas encore.', 'Je dois y réfléchir.', 'On verra selon la suite.', 'Pas de réponse pour le moment.'],
      cold: ['On verra.', 'Aucune idée.', 'Pas maintenant.', 'Je ne sais pas.']
    },
    thanks: {
      warm: ['Avec plaisir !', 'Merci à toi !', 'Ça me fait plaisir que tu le dises.', 'Pas de quoi, on est ensemble.'],
      neutral: ['Pas de souci.', 'De rien.', 'Merci, c’est apprécié.', 'Bien reçu.'],
      cold: ['De rien.', 'OK.', 'Pas de quoi.', 'Oui.']
    },
    gameplay: {
      warm: ['C’est le genre d’action que j’aimerais revoir au ralenti.', 'Il faut un sacré timing pour cette action.', 'Ça mérite un clip !', 'On en parle au prochain entraînement.'],
      neutral: ['Ça se joue au timing.', 'Intéressant à revoir sur le replay.', 'Le placement change tout sur ce genre d’action.', 'Beau geste.'],
      cold: ['Pas mal.', 'J’ai vu.', 'Ça arrive.', 'D’accord.']
    },
    general: {
      warm: ['J’ai vu passer ça. Merci pour le message !', 'Content que tu m’en parles.', 'Ça fait plaisir d’avoir des nouvelles.', 'Je garde ça en tête, merci !', 'J’aimerais bien savoir ce que le reste de l’équipe en pense.'],
      neutral: ['J’ai vu, merci.', 'Je vois ce que tu veux dire.', 'Merci pour l’info.', 'On en reparlera.', 'Bien reçu.'],
      cold: ['OK.', 'Vu.', 'D’accord.', 'Je note.', 'Pas grand-chose à ajouter.']
    }
  };
  const localizedReplies = {
    en: ['Great result!', 'Tough loss. We’ll work on it.', 'Let’s see how the roster settles.', 'Worth watching the replay.', 'Good question. I’ll think about it.', 'Any time!', 'Thanks for reaching out.', 'Got it.', 'Seen.', 'We’ll see.'],
    es: ['¡Buen resultado!', 'Dura derrota. Hay que mejorar.', 'Veamos cómo encaja el equipo.', 'Vale la pena ver la repetición.', 'Buena pregunta. Lo pensaré.', '¡De nada!', 'Gracias por escribir.', 'Entendido.', 'Visto.', 'Ya veremos.'],
    de: ['Starkes Ergebnis!', 'Bittere Niederlage. Wir arbeiten daran.', 'Mal sehen, wie sich das Team findet.', 'Das Replay lohnt sich.', 'Gute Frage. Ich denke darüber nach.', 'Gern geschehen!', 'Danke für deine Nachricht.', 'Verstanden.', 'Gesehen.', 'Mal sehen.'],
    pt: ['Belo resultado!', 'Derrota difícil. Vamos trabalhar nisso.', 'Vamos ver como a equipa se adapta.', 'Vale a pena ver a repetição.', 'Boa pergunta. Vou pensar nisso.', 'De nada!', 'Obrigado pela mensagem.', 'Entendido.', 'Visto.', 'Vamos ver.'],
    ar: ['نتيجة رائعة!', 'خسارة صعبة. سنعمل على التحسن.', 'لنرَ كيف يتأقلم الفريق.', 'تستحق اللقطة إعادة المشاهدة.', 'سؤال جيد. سأفكر فيه.', 'على الرحب والسعة!', 'شكرًا على رسالتك.', 'فهمت.', 'تمت القراءة.', 'سنرى.']
  };
  function responseText(text, mood, seed = '', language = 'fr') {
    const input = String(text || '').toLowerCase();
    let topic = 'general';
    if (/(?:perdu|défaite|loss|lost|rough|déçu)/.test(input)) topic = 'loss';
    else if (/(?:transfer|transfert|recru|sign|roster)/.test(input)) topic = 'roster';
    else if (/(?:reset|arrêt|\bsave\b|replay|clip|aérien)/.test(input)) topic = 'gameplay';
    else if (/(?:\bgg\b|victoire|\bwin\b|\bwon\b|gagn|bravo)/.test(input)) topic = 'win';
    else if (/\?/.test(input)) topic = 'question';
    else if (/(?:merci|thanks|thank you)/.test(input)) topic = 'thanks';
    const translated = localizedReplies[language];
    if (translated) {
      const index = ['win','loss','roster','gameplay','question','thanks','general'].indexOf(topic);
      if (mood === 'cold') return translated[topic === 'question' ? 9 : 8];
      if (mood === 'neutral' && roll(seed + ':brief') < 0.4) return translated[7];
      return translated[index];
    }
    const choices = responseBank[topic][mood];
    return choices[Math.floor(roll(seed + ':' + input) * choices.length)];
  }

  function privateReply(peer, text, language, intent, relationship, history, seed, reason) {
    const mood = tone(peer);
    const input = text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'");
    let topic = intent;
    if (!topic && /^(?:how (?:are you|are things)|how(?:'s| is) it going|comment (?:ca va|vas-tu)|ca va|como (?:estas|vas)|wie geht|كيف حالك)/.test(input)) topic = 'checkin';
    if (!topic && /^(?:hey|hi|hello|salut|yo|bonjour|hola|ola|hallo|مرحبا)[!.\s]*$/.test(input)) topic = 'greeting';
    const banks = {
      en: {
        greeting: [['Hey! How’s it going?', 'Hey, what’s up?'], ['Hey.', 'Hi.'], ['Yeah?', 'Hey.']],
        checkin: [['Doing well, thanks. How about you?', 'Pretty good. Ready for the next series.'], ['I’m okay. A bit tired.', 'Doing alright. How are you?'], ['Not great today.', 'Honestly, I need a bit of space.']],
        conflict: [['I get why you’re frustrated. Let’s review what happened together.', 'I made mistakes too. We can talk about the rotations.'], ['I don’t think that loss was down to one person.', 'Tell me which play bothered you.'], ['Blaming me won’t fix it.', 'I’m not having this conversation right now.']],
        apology: [['Thanks for saying that. Let’s move on.', 'I appreciate the apology. We’re good.'], ['Thanks. Give me a little time.', 'I hear you. Let’s leave it there for now.'], ['I heard you. I still need time.', 'I’m not ready to move on yet.']],
        support: [['Thanks. I needed that after the match.', 'I appreciate it. Let’s build on that.'], ['Thanks, I appreciate it.', 'Good to hear that.'], ['Thanks. I’m still frustrated, though.', 'I appreciate it. I need a minute.']]
      },
      fr: {
        greeting: [['Salut ! Ça va ?', 'Hey, quoi de neuf ?'], ['Salut.', 'Hey.'], ['Oui ?', 'Salut.']],
        checkin: [['Ça va bien, merci. Et toi ?', 'Plutôt bien. Prêt pour la prochaine série.'], ['Ça va, un peu fatigué.', 'Ça va. Et toi ?'], ['Pas très bien aujourd’hui.', 'J’ai surtout besoin de souffler.']],
        conflict: [['Je comprends que tu sois frustré. On peut revoir le match ensemble.', 'J’ai aussi fait des erreurs. Parlons des rotations.'], ['On ne perd pas un match à cause d’une seule personne.', 'Quelle action t’a posé problème ?'], ['Me mettre tout sur le dos ne changera rien.', 'Je préfère qu’on en parle plus tard.']],
        apology: [['Merci de me le dire. On repart sur de bonnes bases.', 'J’apprécie tes excuses. On passe à la suite.'], ['Merci. Laisse-moi un peu de temps.', 'Je t’entends. On en reste là pour le moment.'], ['J’ai entendu. Il me faut encore du temps.', 'Je ne suis pas prêt à tourner la page.']],
        support: [['Merci, j’en avais besoin après le match.', 'Ça fait du bien de l’entendre. On continue ensemble.'], ['Merci, j’apprécie.', 'Ça fait plaisir de l’entendre.'], ['Merci. Je suis encore frustré, quand même.', 'Merci, laisse-moi juste souffler un peu.']]
      }
    };
    const extraBanks = {
      en: {
        thanks: [['You’re welcome. I’d cover that rotation again.', 'Any time. We’ve got each other’s backs.'], ['No problem.', 'You’re welcome.'], ['Sure.', 'No worries.']],
        hype: [['That’s the spirit. Let’s bring it into the next series.', 'I’m with you. One game at a time.'], ['Let’s see it in the next match.', 'We can build on this.'], ['Show me in the next game.', 'One game at a time.']],
        joke: [['That got me. The ball owes us a refund.', 'Okay, that was a good one.'], ['Heh. Fair.', 'I’ll give you that one.'], ['Not in the mood for jokes.', 'Maybe later.']],
        cocky: [['Save some of that confidence for kickoff.', 'Bold claim. Let’s back it up together.'], ['Let the score speak for us.', 'We still need all three players.'], ['We play as a team.', 'Talk after the next game.']],
        mixed: [['I’m not sure how you meant that. Can we talk it through?', 'Are you joking, or do you want to review the match?'], ['I’m not sure what you mean.', 'Are we talking about a specific play?'], ['Say what you mean.', 'Let’s leave it for now.']],
        plain: [['I’m listening. What did you have in mind?', 'Tell me a bit more.'], ['What did you want to talk about?', 'I’m listening.'], ['What is it?', 'Not a good time.']]
      },
      fr: {
        thanks: [['De rien. Je te recouvre quand tu veux.', 'Avec plaisir, on se couvre mutuellement.'], ['Pas de souci.', 'De rien.'], ['OK.', 'Pas de quoi.']],
        hype: [['C’est ça l’esprit. On garde cette énergie.', 'Je te suis. Une manche à la fois.'], ['On va le montrer au prochain match.', 'On peut repartir de là.'], ['On verra au prochain match.', 'Une manche à la fois.']],
        joke: [['Pas mal. Le ballon nous doit un remboursement.', 'Celle-là m’a fait rire.'], ['Pas mal.', 'Je te l’accorde.'], ['J’ai pas trop envie de rire là.', 'Une autre fois.']],
        cocky: [['Garde un peu de confiance pour le kickoff.', 'Belle promesse. On va la tenir ensemble.'], ['Laissons parler le score.', 'On a quand même besoin des trois.'], ['On joue en équipe.', 'On en reparle après le match.']],
        mixed: [['Je ne suis pas sûr d’avoir compris. On en parle ?', 'Tu plaisantes ou tu veux revoir le match ?'], ['Je ne vois pas ce que tu veux dire.', 'Tu parles d’une action précise ?'], ['Dis-moi clairement ce que tu veux dire.', 'On en reparlera.']],
        plain: [['Je t’écoute. Tu avais quoi en tête ?', 'Dis-moi ce que tu veux dire.'], ['Tu voulais parler de quoi ?', 'Je t’écoute.'], ['Qu’est-ce qu’il y a ?', 'C’est pas le bon moment.']]
      }
    };
    const short = {
      es:['¡Hola!','Estoy bien, gracias. ¿Y tú?','No creo que la derrota sea culpa de una sola persona.','Gracias por disculparte.','Gracias por el apoyo.'],
      pt:['Olá!','Estou bem, obrigado. E tu?','Não acho que a derrota tenha sido culpa de uma só pessoa.','Obrigado por pedires desculpa.','Obrigado pelo apoio.'],
      de:['Hey!','Mir geht es gut, danke. Und dir?','Die Niederlage lag nicht an einer Person allein.','Danke für deine Entschuldigung.','Danke für deine Unterstützung.'],
      ar:['مرحبًا!','أنا بخير، شكرًا. وأنت؟','الخسارة ليست مسؤولية لاعب واحد.','شكرًا على الاعتذار.','شكرًا على الدعم.']
    };
    const level = relationship?.trust < 35 || mood === 'cold' ? 2 : mood === 'warm' ? 0 : 1;
    if (topic === 'respect') topic = 'support';
    const localized = banks[language]?.[topic] || extraBanks[language]?.[topic];
    let choices = localized?.[level];
    if (!choices && short[language] && topic) {
      const mapped = ['thanks','hype'].includes(topic) ? 'support' : topic;
      const index = ['greeting','checkin','conflict','apology','support'].indexOf(mapped);
      if (index >= 0) choices = [short[language][index]];
    }
        if (topic === 'conflict' && reason === 'repeated') {
      if (language === 'en') choices = ['We already talked about the loss. Which rotation do you want to review?',
        'I heard you the first time. Tell me what you want us to do differently next match.',
        'We can watch the replay later. Repeating the blame won’t help.'];
      if (language === 'fr') choices = ['On a déjà parlé de la défaite. Quelle rotation veux-tu revoir ?',
        'J’ai compris. Dis-moi ce qu’on devrait changer au prochain match.',
        'On pourra revoir le replay. Répéter le reproche ne changera rien.'];
    }
    const last = history.filter(message => !message.mine).slice(-4).map(message => message.text);
    if (!choices) choices = [0,1,2,3].map(index => responseText(text, mood, seed + ':' + index, language));
    const distinct = [...new Set(choices)];
    const fresh = distinct.filter(line => !last.includes(line));
    const pool = fresh.length ? fresh : distinct;
    return pool[Math.floor(roll(seed) * pool.length)];
  }

  function react(state, request, ...args) {
    const action = request?.ySocial;
    if (!['repost', 'reply', 'comments', 'dm-read', 'dm-send', 'dm-list', 'reposts-list', 'squad-relations'].includes(action)) {
      return toggleLike.call(this, state, request, ...args);
    }
    const social = state.social;
    const id = request.id;
    if (!Number.isSafeInteger(id) || id < 0 || !Array.isArray(social?.posts)) {
      return error('Action indisponible.');
    }

    const archive = Array.isArray(social.archive) ? social.archive : [];
    const wall = [...social.posts, ...archive];
    const addToWall = post => {
      social.posts.unshift(post);
      const cap = engine.TIMELINE_MAX || 220;
      if (social.posts.length > cap) {
        social.archive = archive;
        archive.unshift(...social.posts.splice(cap));
      }
    };
    const user = state.players?.find(player => player.id === state.userPlayerId);
    const handleFor = player => typeof engine.handleFor === 'function' ? engine.handleFor(player.name) : player.name;
    const addReply = (player, original, text, mine = false) => {
      if (!Number.isSafeInteger(state.nextId)) return;
      addToWall({
        id: state.nextId++, date: state.currentDate, kind: 'player', authorId: player.id, name: player.name,
        handle: handleFor(player), followers: player.followers || 0, text, mine, replyTo: original.id,
        likes: 0, reposts: 0, replies: 0, views: 0
      });
      const find = id => social.posts.find(post => post.id === id) || archive.find(post => post.id === id);
      let parent = find(original.id);
      for (let depth = 0; parent && depth < 2; depth++) {
        parent.yReplyDelta = (parent.yReplyDelta || 0) + 1;
        parent = parent.replyTo == null ? null : find(parent.replyTo);
      }
    };
    if (action === 'squad-relations') return success({ ySquad: relationships?.squadSummary(state) });
    if (action === 'reposts-list') return success({ yReposts: wall.filter(post => Number.isSafeInteger(post.yRepostOf)) });
    if (action === 'dm-list') {
      const contacts = Object.entries(social.yDms || {}).map(([key, history]) => {
        const player = state.players?.find(entry => entry.id === Number(key));
        return player ? { id: player.id, name: player.name, handle: handleFor(player), preview: history.at(-1)?.text, date: [...history].reverse().find(message => message.date)?.date } : null;
      }).filter(Boolean);
      return success({ yContacts: contacts });
    }
    if (action === 'dm-read' || action === 'dm-send') {
      const peer = state.players?.find(player => player.id === id && player.id !== state.userPlayerId);
      if (!peer) return error('Ce joueur est introuvable.');
      const saved = social.yDms?.[id] || [];
      const peerInfo = () => ({ yPeer: peer.name, yHandle: handleFor(peer), yRelationship: relationships?.current(state, peer) });
      if (action === 'dm-read') return success({ ...peerInfo(), yMessages: saved });
      const text = typeof request.text === 'string' ? request.text.trim().slice(0, 400) : '';
      if (!text) return error('Écris un message avant de l’envoyer.');
      social.yDms ||= {};
      const reading = relationships?.interpret(text, request.intent);
      const change = relationships?.apply(state, peer, text, request.intent, reading);
      const effect = change?.effect;
      const messages = [...saved, { mine: true, text, date: state.currentDate, ...(effect ? { effect } : change?.reason ? { relationReason: change.reason } : {}) }];
      const teammate = peer.teamId >= 0 && peer.teamId === state.userTeamId;
      const seed = id + ':' + state.currentDate + ':' + text + ':' + saved.length;
      const relationship = relationships?.current(state, peer);
      const trust = relationship?.trust ?? 50;
      if (teammate || roll(seed) < replyChance(state, peer, (trust - 50) / 140)) {
        messages.push({ mine: false, text: privateReply(peer, text, request.lang || 'en', reading?.topic, relationship, saved, seed, change?.reason), date: state.currentDate });
      }
      social.yDms[id] = messages.slice(-80);
      if (reading?.effect === 'conflict' && user && Number.isSafeInteger(state.nextId)) {
        const entry = social.yRelationships?.[id];
        if (entry && typeof state.currentDate === 'string') {
          const time = Date.parse(state.currentDate);
          const within = (date, days) => {
            const age = time - Date.parse(date);
            return age >= 0 && age < days * 86400000;
          };
          const tensions = (entry.tensions || []).filter(date => within(date, 3));
          entry.tensions = [...tensions, state.currentDate].slice(-12);
          entry.conflictCount = (entry.conflictCount || 0) + 1;
          const publicSeed = seed + ':' + entry.conflictCount;
          const chance = Math.min(0.5, entry.tensions.length * 0.075 + (trust < 25 ? 0.12 : 0));
          if (entry.tensions.length >= 3 && !within(entry.lastPublicConflict, 7) && roll(publicSeed + ':public') < chance) {
            const copy = {
              en: ['The DMs from @{user} keep coming. I’m done with the insults.', '@{user}, if there’s a problem, we can talk without the insults.'],
              fr: ['Les DM de @{user} continuent. J’en ai assez des insultes.', '@{user}, si quelque chose ne va pas, on peut en parler sans s’insulter.'],
              es: ['Siguen llegando mensajes de @{user}. Ya basta de insultos.', '@{user}, si hay un problema, podemos hablar sin insultos.'],
              pt: ['As mensagens do @{user} continuam. Já chega de insultos.', '@{user}, se há um problema, podemos falar sem insultos.'],
              de: ['Die DMs von @{user} hören nicht auf. Mir reicht es mit den Beleidigungen.', '@{user}, wenn es ein Problem gibt, können wir ohne Beleidigungen reden.'],
              ar: ['رسائل @{user} لا تتوقف. سئمت الإهانات.', '@{user}، إذا كانت هناك مشكلة فيمكننا التحدث دون إهانات.']
            };
            const variants = copy[request.lang] || copy.en;
            addToWall({
              id: state.nextId++, date: state.currentDate, kind: 'player', authorId: peer.id, name: peer.name,
              handle: handleFor(peer), text: variants[roll(publicSeed + ':words') < 0.5 ? 0 : 1].replace('{user}', () => handleFor(user)),
              likes: 0, replies: 0, reposts: 0, views: 0, yPublicConflict: true
            });
            entry.lastPublicConflict = state.currentDate;
          }
        }
      }
      return success({ ...peerInfo(), yMessages: social.yDms[id] });
    }

    const indexed = new Map(wall.map(post => [post.id, post]));
    const original = indexed.get(id);
    if (!original || Number.isSafeInteger(original.yRepostOf)) return error('Publication introuvable.');
    let root = original;
    let depth = 0;
    while (root.replyTo != null) {
      root = indexed.get(root.replyTo);
      depth++;
      if (!root || depth > 2) return error('Ce fil de commentaires est indisponible.');
    }
    if (!['reply', 'repost'].includes(action) && depth !== 0) return error('Ouvre la publication d’origine.');
    const author = state.players?.find(player => original.kind === 'player' && player.id === original.authorId);
    const thread = () => {
      let parents = new Set([root.id]);
      const replies = [];
      const posts = [...social.posts, ...(social.archive || [])];
      for (let level = 0; level < 2 && parents.size; level++) {
        const children = posts.filter(post => parents.has(post.replyTo));
        replies.push(...children);
        parents = new Set(children.map(post => post.id));
      }
      return success({ yReplies: replies, yRoot: root.id });
    };
    if (action === 'comments') {
      if (original.yCommentsReady) return thread();
      original.yCommentsReady = true;
      const players = (state.players || []).filter(player => player.id >= 0 && player.id !== original.authorId &&
        player.id !== state.userPlayerId && !player.retired && !wall.some(post => post.replyTo === id && post.authorId === player.id));
      const followers = new Set((social.followedBy || []).map(entry => entry.key));
      const regulars = players.filter(player => original.authorId === state.userPlayerId ?
        followers.has('p' + player.id) : author?.teamId >= 0 && player.teamId === author.teamId);
      const others = players.filter(player => !regulars.includes(player));
      const seed = id + ':' + original.date;
      if (roll(seed) < 0.8 && players.length) {
        const pool = regulars.length && roll(seed + ':audience') < 0.78 ? regulars : others.length ? others : regulars;
        const commenter = pool[Math.floor(roll(seed + ':who') * pool.length)];
        if (commenter) addReply(commenter, original, responseText(original.text, tone(commenter), id + ":" + commenter.id, request.lang));
      }
      return thread();
    }
    if (action === 'reply') {
      const text = typeof request.text === 'string' ? request.text.trim().slice(0, 280) : '';
      if (!user || !text) return error('Écris un commentaire avant de l’envoyer.');
      if (depth >= 2) return error('La profondeur maximale de réponses est atteinte.');
      const alreadyReplied = wall.some(post => post.mine && post.replyTo === id);
      const commentId = state.nextId;
      addReply(user, original, text, true);
      const teammate = author?.teamId >= 0 && author.teamId === state.userTeamId;
      if (depth === 0 && author && author.id !== user.id && !alreadyReplied &&
          (teammate || roll('reply:' + id + ':' + text) < replyChance(state, author, 0.15))) {
        addReply(author, { id: commentId }, responseText(text, tone(author), commentId, request.lang));
      }
      return thread();
    }
    if (wall.some(post => post.yRepostOf === id)) {
      social.posts = social.posts.filter(post => post.yRepostOf !== id);
      social.archive = archive.filter(post => post.yRepostOf !== id);
      delete original.yRepostId;
      return success({ ySocialReposted: false });
    }
    if (!Number.isSafeInteger(state.nextId)) return { ok: false, error: 'Republication indisponible.' };

    const repost = {
      id: state.nextId++, date: state.currentDate, yRepostOf: id, mine: true,
      kind: original.kind, authorId: original.authorId, clubId: original.clubId, name: original.name,
      handle: original.handle, text: original.text, gif: original.gif, gifAlt: original.gifAlt,
      verified: original.verified, followers: original.followers, likes: 0, reposts: 0, views: 0, replies: 0
    };
    original.yRepostId = repost.id;
    addToWall(repost);
    if (depth === 0 && author && author.id !== state.userPlayerId && !original.yRepostReacted &&
        roll('repost:' + id) < replyChance(state, author, -0.22)) {
      original.yRepostReacted = true;
      addReply(author, original, responseText('merci thanks', tone(author), id, request.lang));
    }
    return success({ ySocialReposted: true });
  }
  react.rlcYReposts = true;
  engine.toggleLike = react;
  return 'installed';
}

function installMatchPosts(engine, getLanguage, relationships) {
  if (typeof engine?.applyUserResult !== 'function' || typeof engine.advance !== 'function') return 'waiting-engine';
  if (engine.applyUserResult.rlcYMatchPosts) return 'already-installed';

  const originalResult = engine.applyUserResult;
  const originalAdvance = engine.advance;
  const copy = {
    en: ['We won', 'We lost', 'What a comeback', 'An upset to remember', 'A clean sweep', 'It went to the decider', 'in overtime', 'goals', 'saves', 'That series was worth watching.'],
    fr: ['Victoire', 'Défaite', 'Quelle remontée', 'Un exploit à retenir', 'Victoire sans concéder de manche', 'Tout s’est joué à la dernière manche', 'en prolongation', 'buts', 'arrêts', 'Il fallait voir cette série.'],
    es: ['Victoria', 'Derrota', 'Qué remontada', 'Una sorpresa para recordar', 'Victoria sin ceder una partida', 'Todo se decidió en la última partida', 'en la prórroga', 'goles', 'paradas', 'Valió la pena ver esta serie.'],
    pt: ['Vitória', 'Derrota', 'Que reviravolta', 'Uma surpresa para recordar', 'Vitória sem perder um jogo', 'Tudo se decidiu no último jogo', 'no prolongamento', 'golos', 'defesas', 'Valeu a pena ver esta série.'],
    de: ['Sieg', 'Niederlage', 'Was für ein Comeback', 'Eine Überraschung, die bleibt', 'Sieg ohne Spielverlust', 'Alles entschied sich im letzten Spiel', 'in der Verlängerung', 'Tore', 'Paraden', 'Diese Serie war sehenswert.'],
    ar: ['فوز', 'خسارة', 'يا لها من عودة', 'مفاجأة لن تُنسى', 'فوز دون خسارة أي مباراة', 'الحسم في المباراة الأخيرة', 'في الوقت الإضافي', 'أهداف', 'تصديات', 'كانت هذه السلسلة تستحق المشاهدة.']
  };

  function recentDuplicates(state, firstId) {
    const social = state.social;
    if (!Number.isSafeInteger(firstId) || !Array.isArray(social?.posts)) return;
    const archive = Array.isArray(social.archive) ? social.archive : [];
    const allPosts = [...social.posts, ...archive];
    const parents = new Set(allPosts.map(post => post.replyTo));
    const signature = post => [post.kind, post.clubId ?? post.authorId,
      typeof post.text === 'string' ? post.text.trim().toLowerCase().replace(/\s+/g, ' ') : '', post.gif || ''].join('|');
    const seen = new Map();
    const drop = new Set();
    for (const post of allPosts.slice().sort((a, b) => a.id - b.id)) {
      if (!['club', 'player'].includes(post.kind) || !post.text || post.mine || post.own || post.replyTo != null ||
          post.yMatch || post.yRepostOf != null || post.yRepostId != null || parents.has(post.id)) continue;
      const key = signature(post);
      const date = Date.parse(post.date);
      const previous = seen.get(key);
      const duplicate = post.id >= firstId && Number.isFinite(date) && Number.isFinite(previous) &&
        date >= previous && date - previous <= 2 * 86400000;
      if (duplicate) drop.add(post.id);
      else seen.set(key, date);
    }
    if (drop.size) {
      social.posts = social.posts.filter(post => !drop.has(post.id));
      if (Array.isArray(social.archive)) social.archive = archive.filter(post => !drop.has(post.id));
    }
  }

  function append(state, data) {
    state.social ||= { posts: [], prompt: null };
    state.social.posts ||= [];
    const post = { id: state.nextId++, date: state.currentDate, likes: 0, replies: 0, reposts: 0, views: 0, ...data };
    state.social.posts.unshift(post);
    const cap = engine.TIMELINE_MAX || 220;
    if (state.social.posts.length > cap) {
      state.social.archive ||= [];
      state.social.archive.unshift(...state.social.posts.splice(cap));
    }
    return post;
  }

  function wrapResult(state, fixture, report, ...args) {
    const firstId = state.nextId;
    const wasPlayed = fixture?.played;
    let strengthGap;
    if (fixture && !wasPlayed && !fixture.games?.length && typeof engine.teamStrength === 'function') {
      try {
        const side = engine.userSideId?.(state, fixture);
        const other = engine.teamById?.(state, fixture.homeId === side ? fixture.awayId : fixture.homeId);
        const ours = side != null ? engine.sideLineup?.(state, fixture) : null;
        const theirs = other ? engine.lineupFor?.(state, other, fixture) : null;
        if (ours?.length && theirs?.length) strengthGap = engine.teamStrength(state, theirs) - engine.teamStrength(state, ours);
      } catch { /* A strength estimate is optional; always record the match normally. */ }
    }
    const outcome = originalResult.call(this, state, fixture, report, ...args);
    if (outcome?.error || outcome?.alreadyPlayed || wasPlayed || report?.abandoned) return outcome;
    if (Number.isFinite(strengthGap)) fixture.ySocialStrengthGap = strengthGap;
    if (!outcome?.seriesOver) return outcome;
    recentDuplicates(state, firstId);
    if (!Number.isSafeInteger(state.nextId) || !Number.isSafeInteger(fixture.id) || fixture.ySocialMatchPosted) return outcome;

    const home = engine.teamById?.(state, fixture.homeId);
    const away = engine.teamById?.(state, fixture.awayId);
    const side = engine.userSideId?.(state, fixture);
    const isHome = fixture.homeId === side;
    const club = isHome ? home : away;
    const opponent = isHome ? away : home;
    if (!club?.name || !opponent?.name || side == null) return outcome;

    const won = outcome.weWon === true;
    relationships?.recoverAfterSeries(state, fixture, side, won);
    const ours = isHome ? outcome.homeWins : outcome.awayWins;
    const theirs = isHome ? outcome.awayWins : outcome.homeWins;
    if (!Number.isSafeInteger(ours) || !Number.isSafeInteger(theirs)) return outcome;
    let lead = 0;
    let worstLead = 0;
    const games = fixture.games || [];
    for (const game of games) {
      const homeWin = game.homeGoals > game.awayGoals;
      lead += homeWin === isHome ? 1 : -1;
      worstLead = Math.min(worstLead, lead);
    }
    const deciding = games.length > 0 && games.length === outcome.bestOf;
    const finalGame = games.at(-1);
    const overtime = finalGame?.overtime === true;
    const ourLines = isHome ? 'homeLines' : 'awayLines';
    const totals = new Map();
    for (const game of games) {
      if (!game.measured) continue;
      for (const line of game[ourLines] || []) {
        const entry = totals.get(line.id) || { player: engine.playerById?.(state, line.id), goals: 0, saves: 0 };
        entry.goals += Number(line.goals) || 0;
        entry.saves += Number(line.saves) || 0;
        totals.set(line.id, entry);
      }
    }
    const standout = [...totals.values()].filter(entry => entry.player?.name)
      .sort((a, b) => (b.goals * 2 + b.saves) - (a.goals * 2 + a.saves))[0];
    const words = copy[typeof getLanguage === 'function' ? getLanguage() : 'en'] || copy.en;
    let headline = words[won ? 0 : 1];
    if (won && worstLead <= -2) headline = words[2];
    else if (won && fixture.ySocialStrengthGap >= 6) headline = words[3];
    else if (won && theirs === 0 && ours > 1) headline = words[4];
    else if (deciding) headline += ' · ' + words[5];

    const highlight = standout && (standout.goals > 0 || standout.saves > 0) ?
      ' @' + engine.handleFor(standout.player.name) + ' · ' + standout.goals + ' ' + words[7] +
      ' · ' + standout.saves + ' ' + words[8] + '.' : '';
    const post = append(state, {
      kind: 'club', authorId: -1, clubId: club.id, name: club.name, handle: engine.handleFor(club.name),
      text: headline + ' · ' + club.name + ' ' + ours + '–' + theirs + ' ' + opponent.name +
        (overtime ? ' · ' + words[6] : '') + '.' + highlight,
      yMatch: { fixtureId: fixture.id }
    });
    fixture.ySocialMatchPosted = true;

    // One reaction after a notable series, from a known follower if one is available.
    const followedBy = state.social.followedBy || [];
    const fan = (state.players || []).find(player => player.id !== state.userPlayerId &&
      player.teamId !== side && !player.retired && followedBy.some(entry => entry.key === 'p' + player.id));
    if (fan && (worstLead <= -2 || deciding || overtime)) {
      append(state, { kind: 'player', authorId: fan.id, name: fan.name, handle: engine.handleFor(fan.name),
        text: words[9], replyTo: post.id });
      post.replies = 1;
    }
    return outcome;
  }

  function wrapAdvance(state, ...args) {
    const firstId = state.nextId;
    const result = originalAdvance.call(this, state, ...args);
    recentDuplicates(state, firstId);
    return result;
  }
  wrapResult.rlcYMatchPosts = true;
  engine.applyUserResult = wrapResult;
  engine.advance = wrapAdvance;
  return 'installed';
}

module.exports = { installInteractions, installPostEngagement, installReposts, installMatchPosts };
