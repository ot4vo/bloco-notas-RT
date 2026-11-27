import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { marked } from 'https://esm.sh/marked@15';
import DOMPurify from 'https://esm.sh/dompurify@3';
import TurndownService from 'https://esm.sh/turndown@7';
import JSZip from 'https://esm.sh/jszip@3.10.1';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const palette = ['#426783','#507f79','#9c8155','#806d70','#5e8390','#747e89'];
const turndown = new TurndownService({headingStyle:'atx',bulletListMarker:'-',codeBlockStyle:'fenced'});
turndown.addRule('notinhasImage',{filter:node=>node.nodeType===1&&node.classList?.contains('image-block'),replacement:(_content,node)=>{const img=node.querySelector('img[data-path]');return img?'\n\n'+imageSnippet(img.dataset.path,Number(img.dataset.width||480),img.dataset.align||'center')+'\n\n':''}});
turndown.addRule('notinhasFold',{filter:node=>node.nodeType===1&&node.matches?.('details.notinhas-fold'),replacement:(_content,node)=>{const copy=node.cloneNode(true);copy.removeAttribute('open');copy.querySelectorAll('.image-controls,.fold-actions').forEach(el=>el.remove());return '\n\n'+copy.outerHTML+'\n\n'}});
turndown.addRule('lineBreak',{filter:'br',replacement:()=> '  \n'});
const state = { user:null, notes:[], notebooks:[], shortcuts:[], view:'home', notebook:null, tag:null, selected:null, sort:'updated', search:'', saving:false, dirty:false, loading:false, editorMode:'write' };
let supabase, timer, toastTimer, pending = Promise.resolve(), dialogNotebookId = null;
const ready = SUPABASE_URL.startsWith('https://') && !SUPABASE_PUBLISHABLE_KEY.includes('COLE_AQUI');
const formatDate = (value) => new Date(value).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
function notify(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3200)}
function showPage(page){for(const el of ['loading','auth','setup','app'])$(el).classList.toggle('hidden',el!==page)}
function status(t='● Sincronizado',kind=''){$('sync-status').textContent=t;$('sync-status').className='sync-status '+kind}
function errorMessage(e){const m=e?.message||String(e);return m.includes('Invalid login credentials')?'E-mail ou senha incorretos.':m.includes('Email not confirmed')?'Confirme seu e-mail antes de entrar.':m.includes('User already registered')?'Já existe uma conta com esse e-mail.':m}
async function init(){if(!ready){showPage('setup');return}try{supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});const {data:{session},error}=await supabase.auth.getSession();if(error)throw error;bind();if(session?.user)await enter(session.user);else showPage('auth');supabase.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){setAuthMode('recoverUpdate');showPage('auth')}else if(event==='SIGNED_OUT'){state.user=null;state.notes=[];state.notebooks=[];state.shortcuts=[];state.selected=null;showPage('auth')}else if(event==='SIGNED_IN' && session?.user && state.user?.id!==session.user.id){setTimeout(()=>enter(session.user),0)}})}catch(e){showPage('setup');notify('Falha na conexão: '+errorMessage(e));console.error(e)}}
let authMode='login';
function setAuthMode(mode){authMode=mode;const meta={login:['Boas-vindas de volta','Entre para acessar suas anotações.','Entrar na minha conta'],signup:['Crie seu espaço','Comece a guardar o que você aprende.','Criar minha conta'],reset:['Redefinir senha','Enviaremos um link para seu e-mail.','Enviar link de recuperação'],recoverUpdate:['Criar nova senha','Escolha uma senha para sua conta.','Atualizar senha']}[mode];$('auth-title').textContent=meta[0];$('auth-subtitle').textContent=meta[1];$('auth-submit').textContent=meta[2];$('password-group').classList.toggle('hidden',mode==='reset');$('password').required=mode!=='reset';$('email').disabled=mode==='recoverUpdate';$('auth-error').textContent='';$('switch-mode').textContent=mode==='login'?'Criar uma conta':'Voltar para entrar';$('forgot-password').classList.toggle('hidden',mode!=='login')}
function bind(){setAuthMode('login');$('auth-form').addEventListener('submit',authSubmit);$('switch-mode').onclick=()=>setAuthMode(authMode==='login'?'signup':'login');$('forgot-password').onclick=()=>setAuthMode('reset');$('google-login').onclick=signInGoogle;$('export-backup').onclick=exportAll;$('import-backup').onclick=()=>$('backup-file').click();$('backup-file').onchange=async e=>{const file=e.target.files?.[0];e.target.value='';if(file)await importAll(file)};$('signout').onclick=async()=>{await flush();const{error}=await supabase.auth.signOut();if(error)notify(errorMessage(error))};for(const id of ['new-note-side','new-note-top','empty-new'])$(id).onclick=()=>createNote();$('search').oninput=e=>{state.search=e.target.value;renderList()};$('sort').onchange=e=>{state.sort=e.target.value;renderList()};$('open-sidebar').onclick=()=>{document.body.classList.toggle('sidebar-collapsed',false);$('sidebar').classList.toggle('open');updateLayoutButtons()};$('toggle-sidebar').onclick=()=>{document.body.classList.toggle('sidebar-collapsed');$('sidebar').classList.remove('open');updateLayoutButtons()};$('toggle-focus').onclick=()=>{document.body.classList.toggle('focus-mode');updateLayoutButtons()};$('image-lightbox').addEventListener('click',e=>{if(e.target===$('image-lightbox')||e.target.closest('[data-close-lightbox]'))$('image-lightbox').close()});$('close-sidebar').onclick=()=>$('sidebar').classList.remove('open');document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>navigate(el.dataset.view));$('add-notebook').onclick=()=>openNotebookDialog();$('notebook-menu').onclick=()=>openNotebookDialog(state.notebook);$('cancel-notebook').onclick=()=>$('notebook-dialog').close();$('notebook-form').onsubmit=saveNotebook;$('delete-notebook').onclick=deleteNotebook;$('shortcut-new').onclick=()=>openShortcutDialog();$('shortcut-cancel').onclick=()=>$('shortcut-dialog').close();$('shortcut-form').onsubmit=saveShortcut;$('shortcut-delete').onclick=deleteShortcut;$('home-open-graph').onclick=()=>navigate('graph');$('graph-back').onclick=()=>navigate('home');$('graph-filter').oninput=()=>renderGraph();$('quick-close').onclick=()=>$('quick-capture').close();$('quick-form').onsubmit=saveQuickCapture;$('quick-text').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('quick-form').requestSubmit()}};document.addEventListener('keydown',e=>{const inside=e.target.matches('input,textarea,[contenteditable]');if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(state.user)openQuickCapture()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();flush()}if(!inside&&!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='n')createNote()});updateLayoutButtons();window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault()}})}
async function signInGoogle(){const btn=$('google-login');btn.disabled=true;try{const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}});if(error)throw error}catch(e){$('auth-error').textContent='Google: '+errorMessage(e);btn.disabled=false}}
async function authSubmit(e){e.preventDefault();const email=$('email').value.trim(),password=$('password').value,button=$('auth-submit');button.disabled=true;const message=$('auth-error');message.textContent='';message.classList.remove('success');try{let result;if(authMode==='signup'){result=await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});if(!result.error){message.textContent='Conta criada! Verifique seu e-mail caso a confirmação esteja ativada.';message.classList.add('success')}}else if(authMode==='login')result=await supabase.auth.signInWithPassword({email,password});else if(authMode==='reset'){result=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(!result.error){message.textContent='Se esse e-mail existir, você receberá um link de recuperação.';message.classList.add('success')}}else{result=await supabase.auth.updateUser({password});if(!result.error){notify('Senha alterada.');setAuthMode('login')}}if(result?.error)throw result.error}catch(err){message.textContent=errorMessage(err)}finally{button.disabled=false}}
async function enter(user){state.user=user;showPage('app');$('user-email').textContent=user.email||'';$('user-name').textContent=(user.email||'Meu perfil').split('@')[0];$('avatar').textContent=(user.email||'U')[0].toUpperCase();await loadData()}
async function loadData(){state.loading=true;try{const[books,notes,shortcuts]=await Promise.all([supabase.from('notebooks').select('*').order('name'),supabase.from('notes').select('*').order('updated_at',{ascending:false}),supabase.from('shortcuts').select('*').order('position',{ascending:true}).order('created_at',{ascending:true})]);if(books.error)throw books.error;if(notes.error)throw notes.error;state.notebooks=books.data;state.notes=notes.data;state.shortcuts=shortcuts.error?[]:shortcuts.data;state.selected=null;render();if(shortcuts.error)notify('Execute atalhos.sql no Supabase para habilitar os atalhos.')}catch(e){notify('Erro ao carregar dados: '+errorMessage(e));console.error(e)}finally{state.loading=false}}
function currentNotes(){let a=state.notes.filter(n=>state.view==='trash'?!!n.deleted_at:!n.deleted_at);if(['all','home','recent'].includes(state.view))a=a.filter(n=>!n.is_archived);if(state.view==='favorites')a=a.filter(n=>n.is_favorite&&!n.is_archived);if(state.view==='pinned')a=a.filter(n=>n.is_pinned&&!n.is_archived);if(state.view==='archive')a=a.filter(n=>n.is_archived);if(state.view==='recent')a=a.filter(n=>Date.now()-new Date(n.updated_at).getTime()<14*86400000);if(state.view==='notebook')a=a.filter(n=>n.notebook_id===state.notebook&&!n.is_archived);if(state.view==='tag')a=a.filter(n=>n.tags.includes(state.tag)&&!n.is_archived);const q=state.search.toLocaleLowerCase('pt-BR').trim();if(q)a=a.filter(n=>[n.title,n.content,...n.tags].some(x=>x.toLocaleLowerCase('pt-BR').includes(q)));return [...a].sort((x,y)=>{if(state.sort==='alpha')return x.title.localeCompare(y.title,'pt-BR');if(state.sort==='created')return new Date(y.created_at)-new Date(x.created_at);return Number(y.is_pinned)-Number(x.is_pinned)||new Date(y.updated_at)-new Date(x.updated_at)})}
function locationTitle(){if(state.view==='notebook')return state.notebooks.find(b=>b.id===state.notebook)?.name||'Caderno';if(state.view==='tag')return '#'+state.tag;return {home:'Meu cantinho',graph:'Mapa de conhecimento',recent:'Recentes',all:'Todas as notas',favorites:'Favoritas',pinned:'Fixadas',archive:'Arquivadas',trash:'Lixeira'}[state.view]}
function render(){renderSide();renderList();renderEditor();renderHome()}
function renderSide(){const active=state.notes.filter(n=>!n.deleted_at&&!n.is_archived);$('count-all').textContent=active.length;$('count-favorites').textContent=active.filter(n=>n.is_favorite).length;$('count-pinned').textContent=active.filter(n=>n.is_pinned).length;document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===state.view));$('notebooks').innerHTML=state.notebooks.map(b=>`<button class="notebook-item ${state.view==='notebook'&&state.notebook===b.id?'active':''}" data-book="${b.id}"><span class="dot" style="background:${esc(b.color)}"></span><span>${esc(b.name)}</span><span class="count">${active.filter(n=>n.notebook_id===b.id).length}</span></button>`).join('');$('notebooks').querySelectorAll('[data-book]').forEach(el=>el.onclick=()=>navigate('notebook',el.dataset.book));const tags=[...new Set(active.flatMap(n=>n.tags))].sort((a,b)=>a.localeCompare(b,'pt-BR'));$('tags-sidebar').innerHTML=tags.length?tags.map(t=>`<button class="tag-item ${state.view==='tag'&&state.tag===t?'active':''}" data-tag="${esc(t)}"># ${esc(t)}</button>`).join(''):'<span class="muted small" style="padding:5px 13px">As etiquetas aparecerão aqui.</span>';$('tags-sidebar').querySelectorAll('[data-tag]').forEach(el=>el.onclick=()=>navigate('tag',el.dataset.tag));$('section-title').textContent=locationTitle();$('current-location').textContent=locationTitle();$('section-description').textContent=state.view==='trash'?'Notas excluídas podem ser restauradas.':'Capture ideias, conceitos e referências em segundos.';$('notebook-menu').classList.toggle('hidden',state.view!=='notebook')}
function renderList(){const list=currentNotes();$('result-count').textContent=`${list.length} ${list.length===1?'anotação':'anotações'}`;$('notes-list').innerHTML=list.length?list.map(n=>`<button class="note-card ${state.selected===n.id?'selected':''}" data-note="${n.id}"><div class="note-card-header"><h3>${esc(n.title||'Sem título')}</h3><span class="note-flags">${n.is_pinned?'⌁ ':''}${n.is_favorite?'★':''}</span></div><p>${esc(n.content||'Sua anotação está vazia.').replace(/\s+/g,' ').slice(0,200)}</p><div class="note-card-footer"><div class="mini-tags">${n.tags.slice(0,2).map(t=>`<span class="mini-tag">#${esc(t)}</span>`).join('')}</div><span>${formatDate(n.updated_at)}</span></div></button>`).join(''):'<div class="empty-list"><div class="symbol">✧</div><strong>Nada por aqui ainda</strong><p>Crie uma nota ou ajuste sua busca para encontrar o que procura.</p></div>';$('notes-list').querySelectorAll('[data-note]').forEach(el=>el.onclick=()=>selectNote(el.dataset.note))}
async function navigate(view,value=null){await flush();state.view=view;state.notebook=view==='notebook'?value:null;state.tag=view==='tag'?value:null;state.selected=null;state.search='';$('search').value='';$('sidebar').classList.remove('open');$('content-area').classList.remove('editing');render()}
async function selectNote(id){await flush();state.selected=id;state.editorMode='write';if(state.view==='home'||state.view==='graph')state.view='all';renderSide();renderHome();renderList();renderEditor();$('content-area').classList.add('editing')}
async function createNote(){if(!state.user)return;await flush();const payload={user_id:state.user.id,title:'Sem título',content:'',notebook_id:state.view==='notebook'?state.notebook:null,tags:state.view==='tag'?[state.tag]:[]};const{data,error}=await supabase.from('notes').insert(payload).select().single();if(error){notify('Erro ao criar nota: '+errorMessage(error));return}state.notes.unshift(data);state.selected=data.id;if(['home','graph','trash','archive','favorites','pinned','recent'].includes(state.view))state.view='all';state.search='';$('search').value='';state.editorMode='write';$('sidebar').classList.remove('open');$('content-area').classList.add('editing');render();$('note-title')?.focus()}
function currentNote(){return state.notes.find(n=>n.id===state.selected)}
function renderEditor(){const n=currentNote();if(!n){$('editor').innerHTML='<div class="empty-editor"><div class="empty-illustration">✎</div><h2>Suas ideias começam aqui</h2><p>Selecione uma anotação ou crie uma nova para começar a organizar seus aprendizados.</p><button id="empty-new" class="primary">＋ Criar minha primeira nota</button></div>';$('empty-new').onclick=createNote;return}const book=state.notebooks.find(b=>b.id===n.notebook_id);$('editor').innerHTML=`<div class="editor-shell"><div class="editor-toolbar"><div style="display:flex;gap:8px;align-items:center"><button class="tool-btn back-button" id="back-notes">← Voltar</button><span class="editor-badge">${n.deleted_at?'Na lixeira':n.is_archived?'Arquivada':book?esc(book.name):'Anotação'}</span></div><div class="editor-actions">${n.deleted_at?'<button class="tool-btn" id="restore" title="Restaurar">↶ Restaurar</button><button class="tool-btn danger" id="destroy" title="Excluir definitivamente">Excluir</button>':`<button class="tool-btn ${n.is_pinned?'on':''}" id="pin" title="Fixar nota">⌁ Fixar</button><button class="tool-btn ${n.is_favorite?'on':''}" id="favorite" title="Favoritar">${n.is_favorite?'★':'☆'} Favorita</button><button class="tool-btn" id="archive" title="Arquivar">${n.is_archived?'↶ Desarquivar':'▤ Arquivar'}</button><button class="tool-btn danger" id="delete" title="Mover para lixeira">♲</button>`}</div></div><input id="note-title" class="editor-title" maxlength="240" placeholder="Título da anotação" value="${esc(n.title)}" ${n.deleted_at?'disabled':''}/><div class="editor-meta"><span>Em</span><select id="note-book" ${n.deleted_at?'disabled':''}><option value="">Sem caderno</option>${state.notebooks.map(b=>`<option value="${b.id}" ${n.notebook_id===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select><span class="date">Atualizada em ${formatDate(n.updated_at)}</span></div><div class="tag-editor" id="tag-editor">${n.tags.map((t,i)=>`<span class="tag-pill">#${esc(t)} ${n.deleted_at?'':`<button data-remove-tag="${i}" aria-label="Remover etiqueta">×</button>`}</span>`).join('')}<input id="tag-input" placeholder="+ Etiqueta (Enter)" maxlength="40" ${n.deleted_at?'disabled':''}/></div><div class="editor-tabs"><button class="${state.editorMode==='write'?'active':''}" id="tab-write">Escrever</button><button class="${state.editorMode==='preview'?'active':''}" id="tab-preview">Visualizar</button><button id="add-collapse" class="collapse-add" type="button" ${n.deleted_at?'disabled':''} title="Selecione o texto e crie uma seção recolhível">▸ Recolher texto</button><button id="add-image" class="image-add" type="button" ${n.deleted_at?'disabled':''}>＋ Imagem</button><input id="image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden /></div><div class="note-content rich-editor preview ${state.editorMode==='preview'?'hidden':''}" id="note-content" contenteditable="${!n.deleted_at}" role="textbox" aria-label="Conteúdo da anotação" aria-multiline="true" data-placeholder="Escreva suas ideias ou cole uma imagem aqui..."></div><div class="preview ${state.editorMode==='write'?'hidden':''}" id="markdown-preview"></div><div class="editor-hint"><span>Nas seções recolhíveis, abra o menu ⋯ para editar ou remover o bloco.</span><span id="word-count">0 palavras</span></div></div>`;
updatePreview();$('add-collapse')?.addEventListener('mousedown',e=>e.preventDefault());$('add-collapse')?.addEventListener('click',insertCollapsible);$('add-image')?.addEventListener('click',()=>$('image-file').click());$('image-file')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(file)await uploadImage(file);e.target.value=''});$('note-content').addEventListener('paste',async e=>{const image=[...e.clipboardData.items].find(x=>x.type.startsWith('image/'));if(image){e.preventDefault();await uploadImage(image.getAsFile(),captureEditorRange())}});$('note-title').oninput=e=>edit('title',e.target.value);$('note-content').oninput=()=>{syncRichContent()};$('note-content').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('a'))e.preventDefault()});$('note-book').onchange=e=>{edit('notebook_id',e.target.value||null);renderSide()};$('tag-input').onkeydown=e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();const t=e.target.value.trim().replace(/^#/,'').slice(0,40);if(t&&!n.tags.includes(t)&&n.tags.length<20){edit('tags',[...n.tags,t]);renderEditor();$('tag-input').focus()}}};$('tag-editor').querySelectorAll('[data-remove-tag]').forEach(b=>b.onclick=()=>{edit('tags',n.tags.filter((_,i)=>i!==Number(b.dataset.removeTag)));renderEditor()});$('tab-write').onclick=()=>{state.editorMode='write';renderEditor()};$('tab-preview').onclick=()=>{state.editorMode='preview';renderEditor()};$('back-notes').onclick=async()=>{await flush();$('content-area').classList.remove('editing')};if(n.deleted_at){$('restore').onclick=()=>changeNote({deleted_at:null},'Nota restaurada');$('destroy').onclick=async()=>{if(!confirm('Excluir esta nota definitivamente? Esta ação não pode ser desfeita.'))return;await flush();const{error}=await supabase.from('notes').delete().eq('id',n.id);if(error){notify(errorMessage(error));return}state.notes=state.notes.filter(x=>x.id!==n.id);state.selected=null;$('content-area').classList.remove('editing');render();notify('Nota excluída definitivamente')}}else{$('favorite').onclick=()=>changeNote({is_favorite:!n.is_favorite});$('pin').onclick=()=>changeNote({is_pinned:!n.is_pinned});$('archive').onclick=()=>changeNote({is_archived:!n.is_archived},n.is_archived?'Nota desarquivada':'Nota arquivada');$('delete').onclick=()=>{if(confirm('Mover esta nota para a lixeira?'))changeNote({deleted_at:new Date().toISOString()},'Nota movida para a lixeira')}}}
function enhancePreview(root){
 const urlPattern=/https?:\/\/[^\s<>"']+/gi;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 const nodes=[];while(walker.nextNode()){const n=walker.currentNode;if(n.parentElement?.closest('a,pre,code,script,style'))continue;if(urlPattern.test(n.nodeValue))nodes.push(n);urlPattern.lastIndex=0}
 for(const node of nodes){const value=node.nodeValue;const fragment=document.createDocumentFragment();let previous=0;urlPattern.lastIndex=0;
 for(const m of value.matchAll(urlPattern)){const raw=m[0],clean=raw.replace(/[.,!?;:)]*$/,'');fragment.append(document.createTextNode(value.slice(previous,m.index)));try{const u=new URL(clean);if(['http:','https:'].includes(u.protocol)){const link=document.createElement('a');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';link.title=u.href;link.textContent=shortLink(u);fragment.append(link)}else fragment.append(document.createTextNode(clean))}catch{fragment.append(document.createTextNode(clean))}fragment.append(document.createTextNode(raw.slice(clean.length)));previous=m.index+raw.length}
 fragment.append(document.createTextNode(value.slice(previous)));node.replaceWith(fragment)}
 root.querySelectorAll('a').forEach(link=>{try{const url=new URL(link.href);if(!['https:','http:'].includes(url.protocol)){link.replaceWith(document.createTextNode(link.textContent));return}link.target='_blank';link.rel='noopener noreferrer';link.title=url.href;if(link.textContent.trim()===url.href||link.textContent.trim()===url.href.replace(/\/$/,''))link.textContent=shortLink(url)}catch{link.replaceWith(document.createTextNode(link.textContent))}})
}
function shortLink(url){return url.hostname.replace(/^www\./,'')}
const IMAGE_BUCKET='note-images';
const imagePattern=/!\[Foto\|w=(\d+)\|a=(left|center|right)\]\(notinhas:\/\/([^\s)]+)\)/g;
const imageURLs=new Map();
let previewSerial=0;
async function signedImageUrl(path){const cached=imageURLs.get(path);if(cached && cached.expires>Date.now())return cached.url;
 const {data,error}=await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path,3600);
 if(error)throw error;imageURLs.set(path,{url:data.signedUrl,expires:Date.now()+3300000});return data.signedUrl}
function updateLayoutButtons(){const collapsed=document.body.classList.contains('sidebar-collapsed'),focus=document.body.classList.contains('focus-mode');$('toggle-sidebar').textContent=collapsed?'☰ Mostrar menu':'☰ Ocultar menu';$('toggle-sidebar').setAttribute('aria-pressed',String(collapsed));$('toggle-focus').textContent=focus?'⤢ Sair da tela cheia':'⛶ Tela cheia';$('toggle-focus').setAttribute('aria-pressed',String(focus))}
function captureEditorRange(){const selection=window.getSelection();if(!selection?.rangeCount)return null;const range=selection.getRangeAt(0);return $('note-content')?.contains(range.commonAncestorContainer)?range.cloneRange():null}
function syncRichContent(){const root=$('note-content');if(!root||state.editorMode!=='write')return;const clone=root.cloneNode(true);clone.querySelectorAll('.image-controls,.fold-actions').forEach(el=>el.remove());clone.querySelectorAll('[data-image-placeholder]').forEach(el=>el.remove());const md=turndown.turndown(clone.innerHTML).replace(/\n{3,}/g,'\n\n').trim();edit('content',md);$('word-count').textContent=`${(md.match(/\S+/g)||[]).length} palavras`}
function imageSnippet(path,w,a){return `![Foto|w=${w}|a=${a}](notinhas://${path})`}
function makeImageBlock(path,width,align,url,editable=true){const wrapper=document.createElement('div');wrapper.className='image-block align-'+align;wrapper.contentEditable='false';const img=document.createElement('img');img.className='note-image';img.src=url;img.alt='Foto da anotação';img.dataset.path=path;img.dataset.width=String(width);img.dataset.align=align;img.style.width=width+'px';img.draggable=false;img.tabIndex=0;img.title='Clique para ampliar • segure para ajustar';wrapper.append(img);if(editable){const toolbar=document.createElement('div');toolbar.className='image-controls';toolbar.hidden=true;toolbar.innerHTML=`<label>Largura <input type="range" min="120" max="1000" step="20" value="${width}" aria-label="Tamanho da imagem" /></label><button type="button" data-align="left" title="Esquerda">◧</button><button type="button" data-align="center" title="Centro">▣</button><button type="button" data-align="right" title="Direita">◨</button><button type="button" data-move="-1" title="Mover para cima">↑</button><button type="button" data-move="1" title="Mover para baixo">↓</button><button type="button" data-dismiss="true" title="Fechar opções">✕</button>`;wrapper.append(toolbar);
 toolbar.querySelector('input').oninput=e=>{const w=Number(e.target.value);img.style.width=w+'px';img.dataset.width=String(w)};
 toolbar.querySelector('input').onchange=e=>editImage(path,{width:Number(e.target.value)});
 toolbar.querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>editImage(path,{align:b.dataset.align}));
 toolbar.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>moveImage(path,Number(b.dataset.move)));
 toolbar.querySelector('[data-dismiss]').onclick=()=>toolbar.hidden=true;
 let pressTimer=null,longPressed=false,startX=0,startY=0;
 img.addEventListener('pointerdown',e=>{if(e.button!==0)return;longPressed=false;startX=e.clientX;startY=e.clientY;clearTimeout(pressTimer);pressTimer=setTimeout(()=>{longPressed=true;toolbar.hidden=false;wrapper.classList.add('options-open')},500)});
 img.addEventListener('pointermove',e=>{if(Math.abs(e.clientX-startX)>12||Math.abs(e.clientY-startY)>12)clearTimeout(pressTimer)});
 for(const ev of ['pointerup','pointercancel','pointerleave'])img.addEventListener(ev,()=>clearTimeout(pressTimer));
 img.addEventListener('contextmenu',e=>{e.preventDefault();clearTimeout(pressTimer);longPressed=true;toolbar.hidden=false});
 img.addEventListener('click',e=>{e.preventDefault();if(longPressed){longPressed=false;return}openImageLightbox(url)});
 img.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();openImageLightbox(url)}if(e.key===' '){e.preventDefault();toolbar.hidden=!toolbar.hidden}})
 }else img.addEventListener('click',()=>openImageLightbox(url));return wrapper}
function openImageLightbox(url){const dialog=$('image-lightbox');$('lightbox-image').src=url;if(!dialog.open)dialog.showModal()}
async function uploadImage(file,range=captureEditorRange()){const n=currentNote();if(!n||n.deleted_at||!file)return;
 if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){notify('Use JPG, PNG, WEBP ou GIF.');return}
 if(file.size>8*1024*1024){notify('A imagem deve ter até 8 MB.');return}
 const noteId=n.id;const path=`${state.user.id}/${noteId}/${crypto.randomUUID()}.${file.type.split('/')[1]==='jpeg'?'jpg':file.type.split('/')[1]}`;
 status('● Enviando imagem...','saving');
 const {error}=await supabase.storage.from(IMAGE_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
 if(error){notify('Não foi possível enviar a imagem: '+errorMessage(error));status('● Erro no envio','error');return}
 if(state.selected!==noteId){notify('Imagem enviada. Volte à nota anterior para inseri-la.');return}
 let url;try{url=await signedImageUrl(path)}catch(e){notify('Imagem enviada, mas não foi possível carregá-la: '+errorMessage(e));return}
 const root=$('note-content');if(!root)return;
 const block=makeImageBlock(path,480,'center',url,true);
 if(range&&root.contains(range.commonAncestorContainer)){range.collapse(false);range.insertNode(block);const spacer=document.createElement('p');spacer.append(document.createElement('br'));block.after(spacer)}else{root.append(block);const spacer=document.createElement('p');spacer.append(document.createElement('br'));root.append(spacer)}
 syncRichContent();await updatePreview(false);notify('Imagem adicionada à anotação!')}
function editImage(path,change){const n=currentNote();if(!n||n.deleted_at)return;const m=[...n.content.matchAll(imagePattern)].find(x=>x[3]===path);if(!m)return;
 const width=change.width??Number(m[1]),align=change.align??m[2];const next=n.content.slice(0,m.index)+imageSnippet(path,width,align)+n.content.slice(m.index+m[0].length);
 edit('content',next);updatePreview(true)}
function moveImage(path,direction){const root=$('note-content');const img=[...root.querySelectorAll('img.note-image')].find(x=>x.dataset.path===path);if(!img)return;const block=img.closest('.image-block');const siblings=[...root.children].filter(el=>el.matches('.image-block,p,div,h1,h2,h3,blockquote,ul,ol,pre'));const index=siblings.indexOf(block),target=siblings[index+direction];if(!target){notify('A imagem já está no limite.');return}if(direction<0)target.before(block);else target.after(block);syncRichContent();updatePreview(false)}
async function updatePreview(rebuildEditor=true){const n=currentNote();if(!n)return;const current=++previewSerial;
 $('word-count').textContent=`${(n.content.trim().match(/\S+/g)||[]).length} palavras`;
 const paths=[...new Set([...n.content.matchAll(imagePattern)].map(m=>m[3]))];const links=await Promise.all(paths.map(async path=>{try{return [path,await signedImageUrl(path)]}catch{return [path,null]}}));
 if(current!==previewSerial||state.selected!==n.id||!$('markdown-preview'))return;
 const urlMap=new Map(links),entries=[];
 const text=n.content.replace(imagePattern,(whole,w,a,path)=>{const id=`NOTINHASIMG${entries.length}END`;entries.push({id,width:Math.min(1000,Math.max(120,Number(w))),align:a,path,url:urlMap.get(path)});return '\n\n'+id+'\n\n'});
 let html=marked.parse(text,{breaks:true});for(const entry of entries){html=html.replace(entry.id,`<span data-image-placeholder="${entries.indexOf(entry)}"></span>`)}
 html=DOMPurify.sanitize(html,{ADD_ATTR:['data-image-placeholder']});
 const preview=$('markdown-preview');preview.innerHTML=html;enhancePreview(preview);bindFoldInteractions(preview);
 for(const placeholder of [...preview.querySelectorAll('[data-image-placeholder]')]){const entry=entries[Number(placeholder.dataset.imagePlaceholder)];const node=entry.url?makeImageBlock(entry.path,entry.width,entry.align,entry.url,false):document.createTextNode('Imagem indisponível (confira o Storage)');if(placeholder.parentElement?.tagName==='P'&&placeholder.parentElement.textContent.trim()==='')placeholder.parentElement.replaceWith(node);else placeholder.replaceWith(node)}
 if(rebuildEditor&&$('note-content')){const editor=$('note-content');editor.innerHTML=html;enhancePreview(editor);bindFoldInteractions(editor);for(const placeholder of [...editor.querySelectorAll('[data-image-placeholder]')]){const entry=entries[Number(placeholder.dataset.imagePlaceholder)];const node=entry.url?makeImageBlock(entry.path,entry.width,entry.align,entry.url,!n.deleted_at):document.createTextNode('Imagem indisponível (confira o Storage)');if(placeholder.parentElement?.tagName==='P'&&placeholder.parentElement.textContent.trim()==='')placeholder.parentElement.replaceWith(node);else placeholder.replaceWith(node)}}
}
function edit(field,value){const n=currentNote();if(!n)return;n[field]=value;state.dirty=true;status('● Salvando...','saving');clearTimeout(timer);timer=setTimeout(()=>flush(),850);if(field==='title'||field==='content')renderList();if(field==='tags')renderSide()}
async function flush(){clearTimeout(timer);if(!state.dirty)return pending;const n=currentNote();if(!n)return;state.dirty=false;const id=n.id,payload={title:n.title||'Sem título',content:n.content,tags:n.tags,notebook_id:n.notebook_id,is_favorite:n.is_favorite,is_pinned:n.is_pinned,is_archived:n.is_archived,deleted_at:n.deleted_at};pending=pending.catch(()=>{}).then(async()=>{const{data,error}=await supabase.from('notes').update(payload).eq('id',id).select('updated_at').single();if(error){state.dirty=true;status('● Erro ao salvar','error');notify('Não foi possível salvar: '+errorMessage(error));throw error}const saved=state.notes.find(x=>x.id===id);if(saved)saved.updated_at=data.updated_at;if(!state.dirty)status('● Sincronizado')});return pending.catch(()=>{})}
async function changeNote(changes,message){await flush();const n=currentNote();if(!n)return;const old={...n};Object.assign(n,changes);const{data,error}=await supabase.from('notes').update(changes).eq('id',n.id).select().single();if(error){Object.assign(n,old);notify(errorMessage(error));return}Object.assign(n,data);render();if(message)notify(message)}
function openNotebookDialog(id=null){dialogNotebookId=id;const b=state.notebooks.find(x=>x.id===id);$('notebook-dialog-title').textContent=b?'Editar caderno':'Novo caderno';$('notebook-name').value=b?.name||'';$('delete-notebook').classList.toggle('hidden',!b);const color=b?.color||palette[0];$('colors').innerHTML=palette.map(c=>`<button type="button" class="color-choice ${c===color?'selected':''}" data-color="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('');$('colors').querySelectorAll('button').forEach(x=>x.onclick=()=>{$('colors').querySelectorAll('button').forEach(a=>a.classList.remove('selected'));x.classList.add('selected')});$('notebook-dialog').showModal()}
async function saveNotebook(e){e.preventDefault();const name=$('notebook-name').value.trim();if(!name)return;const color=$('colors').querySelector('.selected')?.dataset.color||palette[0];const result=dialogNotebookId?await supabase.from('notebooks').update({name,color}).eq('id',dialogNotebookId).select().single():await supabase.from('notebooks').insert({user_id:state.user.id,name,color}).select().single();if(result.error){notify(errorMessage(result.error));return}if(dialogNotebookId)state.notebooks=state.notebooks.map(b=>b.id===dialogNotebookId?result.data:b);else state.notebooks.push(result.data);$('notebook-dialog').close();render();notify('Caderno salvo!')}
async function deleteNotebook(){const id=dialogNotebookId;if(!id)return;if(!confirm('Excluir este caderno? As notas serão mantidas em “Sem caderno”.'))return;await flush();const{error}=await supabase.from('notebooks').delete().eq('id',id);if(error){notify(errorMessage(error));return}state.notebooks=state.notebooks.filter(b=>b.id!==id);state.notes.forEach(n=>{if(n.notebook_id===id)n.notebook_id=null});$('notebook-dialog').close();if(state.notebook===id){state.view='all';state.notebook=null;state.selected=null}render();notify('Caderno excluído; anotações preservadas')}
function insertCollapsible(){
 const root=$('note-content');
 if(!root||state.editorMode!=='write'){notify('Abra a aba Escrever para criar uma seção.');return}
 const selection=window.getSelection();
 const range=captureEditorRange();
 if(!range||range.collapsed){notify('Selecione o texto que deseja recolher.');return}
 const startElement=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
 const endElement=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
 if(startElement?.closest('details.notinhas-fold')||endElement?.closest('details.notinhas-fold')){
   notify('Não é possível criar uma seção dentro de outra.');return;
 }
 const fragmentPreview=range.cloneContents();
 if(fragmentPreview.querySelector('img,.image-block,details')){
   notify('Selecione apenas texto, sem imagens ou outras seções.');return;
 }
 const chosen=range.toString().trim();
 if(!chosen){notify('Selecione algum texto para recolher.');return}
 const suggested=chosen.split('\n').find(x=>x.trim())?.trim().slice(0,65)||'Resumo';
 const answer=prompt('Título da seção recolhível:',suggested);
 if(answer===null)return;
 const details=document.createElement('details');details.className='notinhas-fold';details.open=true;
 const summary=document.createElement('summary');summary.textContent=answer.trim()||'Resumo';summary.contentEditable='false';summary.setAttribute('tabindex','0');
 const content=document.createElement('div');content.className='notinhas-fold-content';
 const extracted=range.extractContents();content.append(extracted);
 details.append(summary,content);
 const marker=document.createElement('span');marker.dataset.foldMarker='';range.insertNode(marker);
 let top=marker;
 while(top.parentNode&&top.parentNode!==root)top=top.parentNode;
 if(top===marker){marker.replaceWith(details)}
 else if(top.parentNode===root){
   const tailRange=document.createRange();tailRange.setStartAfter(marker);tailRange.setEnd(top,top.childNodes.length);
   const trailing=tailRange.extractContents();
   const suffix=top.cloneNode(false);suffix.append(trailing);
   marker.remove();top.after(details);
   if(suffix.textContent.trim()||suffix.querySelector('img,br,.image-block'))details.after(suffix);
   if(!top.textContent.trim()&&!top.querySelector('img,br,.image-block'))top.remove();
 }
 // A seleção pode conter parágrafos; nunca criar um bloco pai dentro de outro.
 selection.removeAllRanges();ensureFoldWritingSpace(root,details);bindFoldInteractions(root);syncRichContent();notify('Seção criada. Use + Abaixo para continuar escrevendo.');
}
// Mantenha um parágrafo editável fora da seção, mesmo quando ela for o último elemento.
function ensureFoldWritingSpace(root,details){
 if(!details||details.parentElement!==root)return;
 const after=details.nextElementSibling;
 if(!after || after.matches('details.notinhas-fold,.image-block') || after.getAttribute('contenteditable')==='false'){
  const paragraph=document.createElement('p');paragraph.append(document.createElement('br'));details.after(paragraph);
 }
}
function focusAfterFold(details){
 const root=$('note-content');if(!root||!root.contains(details))return;
 let next=details.nextElementSibling;
 if(!next||!next.matches('p')||next.contentEditable==='false'){
  next=document.createElement('p');next.append(document.createElement('br'));details.after(next);
 }
 const range=document.createRange();range.selectNodeContents(next);range.collapse(false);
 const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);root.focus();
 next.scrollIntoView({block:'nearest'});syncRichContent();
}
function unfoldToNormal(details){
 const root=$('note-content');if(!root||!root.contains(details))return;
 const title=details.querySelector(':scope > summary')?.firstChild?.textContent?.trim()||'Resumo';
 const content=details.querySelector(':scope > .notinhas-fold-content');
 const fragment=document.createDocumentFragment();
 const heading=document.createElement('p');const strong=document.createElement('strong');strong.textContent=title;heading.append(strong);fragment.append(heading);
 if(content){while(content.firstChild)fragment.append(content.firstChild)}
 const anchor=document.createElement('p');anchor.append(document.createElement('br'));fragment.append(anchor);
 details.replaceWith(fragment);root.focus();
 const range=document.createRange();range.selectNodeContents(anchor);range.collapse(true);
 window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);
 syncRichContent();notify('Seção transformada em texto normal.');
}
function deleteFold(details){
 const root=$('note-content');if(!root||!root.contains(details))return;
 if(!confirm('Excluir a seção e todo o texto dentro dela?'))return;
 const next=document.createElement('p');next.append(document.createElement('br'));
 details.replaceWith(next);root.focus();
 const range=document.createRange();range.selectNodeContents(next);range.collapse(true);
 window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);
 syncRichContent();notify('Seção excluída.');
}
function closeFoldMenus(except=null){
 document.querySelectorAll('.fold-actions.is-open').forEach(actions=>{
  if(actions===except)return;
  actions.classList.remove('is-open');
  const trigger=actions.querySelector('.fold-menu-trigger');
  if(trigger)trigger.setAttribute('aria-expanded','false');
 });
}
function bindFoldInteractions(root){
 if(!root)return;
 const editable=root.id==='note-content' && root.getAttribute('contenteditable')!=='false';
 root.querySelectorAll('details.notinhas-fold').forEach(details=>{
  const summary=details.querySelector(':scope > summary');if(!summary)return;
  summary.contentEditable='false';summary.tabIndex=0;
  if(!editable)return;
  if(!summary.querySelector('.fold-actions')){
   const actions=document.createElement('span');actions.className='fold-actions';actions.contentEditable='false';
   actions.innerHTML='<button type="button" class="fold-menu-trigger" aria-label="Opções da seção" aria-expanded="false" title="Opções da seção">⋯</button><span class="fold-menu" role="group" aria-label="Opções da seção"><button type="button" data-fold-action="after">+ Escrever abaixo</button><button type="button" data-fold-action="normal">Transformar em texto normal</button><button type="button" data-fold-action="delete">Excluir seção</button></span>';
   summary.append(actions);
   actions.addEventListener('pointerdown',e=>e.stopPropagation());
   actions.addEventListener('mousedown',e=>e.stopPropagation());
   actions.addEventListener('click',e=>{
    const trigger=e.target.closest('.fold-menu-trigger');
    if(trigger){e.preventDefault();e.stopPropagation();const open=!actions.classList.contains('is-open');closeFoldMenus();actions.classList.toggle('is-open',open);trigger.setAttribute('aria-expanded',String(open));return}
    const btn=e.target.closest('button[data-fold-action]');if(!btn)return;
    e.preventDefault();e.stopPropagation();closeFoldMenus();
    if(btn.dataset.foldAction==='after')focusAfterFold(details);
    else if(btn.dataset.foldAction==='normal')unfoldToNormal(details);
    else if(btn.dataset.foldAction==='delete')deleteFold(details);
   });
   actions.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFoldMenus();actions.querySelector('.fold-menu-trigger').focus()}
   });
  }
  if(!summary.dataset.foldBound){
   summary.dataset.foldBound='true';
   summary.addEventListener('click',e=>{if(e.target.closest('.fold-actions'))return;e.preventDefault();e.stopPropagation();closeFoldMenus();details.open=!details.open});
   summary.addEventListener('keydown',e=>{if(e.target.closest('.fold-actions'))return;if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();closeFoldMenus();details.open=!details.open}});
  }
  ensureFoldWritingSpace(root,details);
 });
 if(!document.body.dataset.foldMenuDismissBound){
  document.body.dataset.foldMenuDismissBound='true';
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.fold-actions'))closeFoldMenus()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeFoldMenus()});
 }
}
const BACKUP_FORMAT='notinhas-backup';
function uniqueImagePaths(notes){const found=new Set();for(const n of notes){for(const match of (n.content||'').matchAll(imagePattern))found.add(match[3]);}return [...found]}
async function fetchAllRows(table){const rows=[];for(let start=0;;start+=500){const {data,error}=await supabase.from(table).select('*').order('created_at',{ascending:true}).range(start,start+499);if(error)throw error;rows.push(...data);if(data.length<500)break;}return rows}
function setBackupBusy(busy){for(const id of ['export-backup','import-backup'])$(id).disabled=busy}
async function exportAll(){if(!state.user)return;setBackupBusy(true);try{
 await flush();if(state.dirty)throw new Error('Há alterações não sincronizadas. Tente novamente após salvar.');
 notify('Preparando backup completo...');const [notes,notebooks]=await Promise.all([fetchAllRows('notes'),fetchAllRows('notebooks')]);
 const zip=new JSZip(),images=uniqueImagePaths(notes),imageEntries=[];
 for(let i=0;i<images.length;i++){
   const path=images[i],{data,error}=await supabase.storage.from(IMAGE_BUCKET).download(path);
   if(error||!data)throw new Error(`Não foi possível incluir a imagem ${i+1}/${images.length}: ${path}. Backup cancelado para evitar imagens faltando.`);
   const archivedName=`images/${String(i).padStart(5,'0')}`;
   zip.file(archivedName,data);imageEntries.push({original_path:path,file:archivedName,mime:data.type||'application/octet-stream'});
 }
 zip.file('manifest.json',JSON.stringify({format:BACKUP_FORMAT,version:1,exported_at:new Date().toISOString(),notebooks,notes,images:imageEntries},null,2));
 const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`notinhas-backup-${new Date().toISOString().slice(0,10)}.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 notify(`Backup concluído: ${notes.length} notas e ${images.length} imagens.`);
 }catch(e){console.error(e);notify('Exportação interrompida: '+errorMessage(e));alert('Não foi possível gerar um backup completo. '+errorMessage(e))}finally{setBackupBusy(false)}}
function validateBackup(manifest,zip){
 if(manifest?.format!==BACKUP_FORMAT||manifest.version!==1||!Array.isArray(manifest.notes)||!Array.isArray(manifest.notebooks)||!Array.isArray(manifest.images))throw new Error('Arquivo não é um backup compatível do notinhas.');
 if(manifest.notes.length>100000||manifest.notebooks.length>10000||manifest.images.length>100000)throw new Error('Backup excede os limites de segurança.');
 const ids=new Set(),books=new Set(),paths=new Set();
 for(const b of manifest.notebooks){if(typeof b.id!=='string'||typeof b.name!=='string'||books.has(b.id))throw new Error('Caderno inválido no backup.');books.add(b.id)}
 for(const n of manifest.notes){if(typeof n.id!=='string'||typeof n.title!=='string'||typeof n.content!=='string'||!Array.isArray(n.tags)||ids.has(n.id))throw new Error('Nota inválida no backup.');ids.add(n.id)}
 for(const entry of manifest.images){if(typeof entry.original_path!=='string'||!/^images\/\d{5}$/.test(entry.file)||!zip.file(entry.file)||paths.has(entry.original_path))throw new Error('Imagem ausente ou duplicada no backup.');paths.add(entry.original_path)}
 for(const path of uniqueImagePaths(manifest.notes))if(!paths.has(path))throw new Error('Backup incompleto: falta uma imagem referenciada por uma nota.');
}
async function importAll(file){if(!state.user)return;setBackupBusy(true);let created=0;try{
 await flush();if(state.dirty)throw new Error('Salve a nota atual antes de importar.');
 if(!file.name.toLowerCase().endsWith('.zip'))throw new Error('Selecione o arquivo ZIP exportado pelo notinhas.');
 const zip=await JSZip.loadAsync(file),raw=await zip.file('manifest.json')?.async('string');if(!raw)throw new Error('O ZIP não contém manifest.json.');
 const manifest=JSON.parse(raw);validateBackup(manifest,zip);
 const answer=confirm(`Importar ${manifest.notes.length} notas, ${manifest.notebooks.length} cadernos e ${manifest.images.length} imagens?\n\nA importação cria cópias novas e NÃO apaga as notas existentes.`);if(!answer)return;
 notify('Importando cadernos, notas e imagens...');
 const bookIds=new Map();for(const book of manifest.notebooks){const {data,error}=await supabase.from('notebooks').insert({user_id:state.user.id,name:book.name.slice(0,80),color:/^#[a-f0-9]{6}$/i.test(book.color)?book.color:'#8b5cf6'}).select('id').single();if(error)throw error;bookIds.set(book.id,data.id)}
 const files=new Map(manifest.images.map(e=>[e.original_path,e]));
 for(const note of manifest.notes){
  const newId=crypto.randomUUID();let content=note.content;
  const paths=[...new Set([...content.matchAll(imagePattern)].map(m=>m[3]))];
  const newPaths=new Map();for(const oldPath of paths){
    const entry=files.get(oldPath);if(!entry)throw new Error(`Imagem ausente: ${oldPath}`);
    const blob=await zip.file(entry.file).async('blob');
    if(blob.size>8*1024*1024)throw new Error(`Imagem acima de 8 MB: ${oldPath}`);
    const ext=(oldPath.match(/\.(png|jpe?g|webp|gif)$/i)?.[1]||'png').replace('jpeg','jpg');
    const mime=({jpg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'})[ext];
    if(!mime)throw new Error('Formato de imagem não suportado.');
    const newPath=`${state.user.id}/${newId}/${crypto.randomUUID()}.${ext}`;
    const {error}=await supabase.storage.from(IMAGE_BUCKET).upload(newPath,blob,{contentType:mime,upsert:false});if(error)throw error;
    newPaths.set(oldPath,newPath);
  }
  content=content.replace(imagePattern,(full,w,a,path)=>imageSnippet(newPaths.get(path)||path,w,a));
  const payload={id:newId,user_id:state.user.id,title:note.title.slice(0,240),content,notebook_id:bookIds.get(note.notebook_id)||null,tags:note.tags.filter(t=>typeof t==='string').slice(0,20),is_favorite:!!note.is_favorite,is_pinned:!!note.is_pinned,is_archived:!!note.is_archived,deleted_at:note.deleted_at||null,created_at:note.created_at||new Date().toISOString()};
  const {error}=await supabase.from('notes').insert(payload);if(error)throw error;created++;
 }
 await loadData();notify(`Importação concluída: ${created} notas restauradas.`);alert(`Importação concluída!\n${created} notas e seus arquivos de imagem foram importados. As notas antigas foram mantidas.`);
 }catch(e){console.error(e);notify('Erro na importação: '+errorMessage(e));alert(`Importação interrompida após ${created} notas. As notas já criadas foram preservadas; o arquivo ZIP pode ser usado novamente, mas isso criará duplicatas.\n\n${errorMessage(e)}`);await loadData()}finally{setBackupBusy(false)}}

function homePlainText(content=''){
  const plain=String(content).replace(/<[^>]*>/g,' ').replace(/!\[[^\]]*\]\([^)]*\)/g,' [imagem] ').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/https?:\/\/\S+/g,'link').replace(/[#*_`>~|]/g,' ').replace(/\s+/g,' ').trim();
  return plain.length>155?plain.slice(0,155)+'…':plain;
}
function homeNoteMarkup(n){
  const book=state.notebooks.find(b=>b.id===n.notebook_id);
  return `<button class="home-note" data-home-note="${esc(n.id)}"><span class="home-note-top"><strong>${esc(n.title||'Sem título')}</strong><span>${n.is_pinned?'⌁ ':''}${n.is_favorite?'★':''}</span></span><span class="home-note-preview">${esc(homePlainText(n.content)||'Anotação sem texto.')}</span><span class="home-note-meta">${book?esc(book.name)+' · ':''}${formatDate(n.updated_at)}</span></button>`;
}
function safeShortcutUrl(input){
  let raw=String(input||'').trim();
  if(!raw)throw new Error('Insira o endereço do site.');
  if(!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw))raw='https://'+raw;
  let u;try{u=new URL(raw)}catch{throw new Error('Link inválido. Confira o endereço.');}
  if(!['https:','http:'].includes(u.protocol)||!u.hostname.includes('.')||u.username||u.password)throw new Error('Use um endereço HTTP ou HTTPS válido.');
  return u.href;
}
function shortcutDomain(url){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return 'site externo'}}
function renderHome(){
  const home=state.view==='home';
  $('home-screen').classList.toggle('hidden',!home);
  $('graph-screen').classList.toggle('hidden',state.view!=='graph');
  $('content-area').classList.toggle('hidden',home||state.view==='graph');
  if(state.view==='graph'){renderGraph();return}
  document.body.classList.toggle('home-active',home);
  if(!home)return;
  const active=state.notes.filter(n=>!n.deleted_at&&!n.is_archived);
  const week=active.filter(n=>Date.now()-new Date(n.updated_at).getTime()<=7*86400000);
  const sorted=[...active].sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
  const pinned=sorted.filter(n=>n.is_pinned).slice(0,4);
  $('home-total').textContent=active.length;
  $('home-week').textContent=week.length;
  $('home-books').textContent=state.notebooks.length;
  $('home-favorites').textContent=active.filter(n=>n.is_favorite).length;
  $('home-recents').innerHTML=sorted.length?sorted.slice(0,5).map(homeNoteMarkup).join(''):'<div class="home-empty">Sua biblioteca ainda está vazia. Crie a primeira anotação para começar.</div>';
  $('home-pinned').innerHTML=pinned.length?pinned.map(homeNoteMarkup).join(''):'<div class="home-empty">Fixe suas notas mais importantes para encontrá-las aqui.</div>';
  $('home-cadernos').innerHTML=state.notebooks.length?state.notebooks.slice(0,8).map(b=>`<button class="home-book" data-home-book="${esc(b.id)}"><span class="home-book-dot" style="background:${esc(b.color)}"></span><strong>${esc(b.name)}</strong><span>${active.filter(n=>n.notebook_id===b.id).length}</span></button>`).join(''):'<div class="home-empty">Seus cadernos aparecerão aqui.</div>';
  $('home-shortcuts').innerHTML=state.shortcuts.length?state.shortcuts.map(s=>`<div class="shortcut-card"><a class="shortcut-open" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="Abrir ${esc(s.name)}"><span class="shortcut-icon">↗</span><strong>${esc(s.name)}</strong><small>${esc(shortcutDomain(s.url))}</small></a><button class="shortcut-edit" type="button" data-edit-shortcut="${esc(s.id)}" title="Editar atalho" aria-label="Editar ${esc(s.name)}">⋯</button></div>`).join(''):'<div class="home-empty">Salve os sites que você mais acessa. Eles aparecerão aqui como botões.</div>';
  $('home-screen').querySelectorAll('[data-home-note]').forEach(el=>el.onclick=async()=>{await navigate('all');await selectNote(el.dataset.homeNote)});
  $('home-screen').querySelectorAll('[data-home-book]').forEach(el=>el.onclick=()=>navigate('notebook',el.dataset.homeBook));
  $('home-screen').querySelectorAll('[data-edit-shortcut]').forEach(el=>el.onclick=()=>openShortcutDialog(el.dataset.editShortcut));
  $('home-new-note').onclick=createNote;
  $('home-all-notes').onclick=()=>navigate('all');
  $('home-add-book').onclick=()=>openNotebookDialog();
}
let editingShortcutId=null;
function openShortcutDialog(id=null){
  editingShortcutId=id;
  const existing=state.shortcuts.find(x=>x.id===id);
  $('shortcut-dialog-title').textContent=existing?'Editar atalho':'Novo atalho';
  $('shortcut-name').value=existing?.name||'';
  $('shortcut-url').value=existing?.url||'';
  $('shortcut-delete').classList.toggle('hidden',!existing);
  $('shortcut-dialog').showModal();
  $('shortcut-name').focus();
}
async function saveShortcut(e){
  e.preventDefault();
  const name=$('shortcut-name').value.trim();
  if(!name||name.length>80){notify('Escolha um nome de até 80 caracteres.');return}
  let url;try{url=safeShortcutUrl($('shortcut-url').value)}catch(error){notify(error.message);return}
  const submit=$('shortcut-form').querySelector('[type=submit]');submit.disabled=true;
  try{
    if(editingShortcutId){const {data,error}=await supabase.from('shortcuts').update({name,url}).eq('id',editingShortcutId).select().single();if(error)throw error;state.shortcuts=state.shortcuts.map(x=>x.id===data.id?data:x)}
    else{const {data,error}=await supabase.from('shortcuts').insert({user_id:state.user.id,name,url,position:state.shortcuts.length}).select().single();if(error)throw error;state.shortcuts.push(data)}
    $('shortcut-dialog').close();renderHome();notify('Atalho salvo!');
  }catch(error){notify('Não foi possível salvar: '+errorMessage(error))}finally{submit.disabled=false}
}
async function deleteShortcut(){
  if(!editingShortcutId||!confirm('Excluir este atalho?'))return;
  const {error}=await supabase.from('shortcuts').delete().eq('id',editingShortcutId);
  if(error){notify(errorMessage(error));return}
  state.shortcuts=state.shortcuts.filter(x=>x.id!==editingShortcutId);
  $('shortcut-dialog').close();renderHome();notify('Atalho excluído.');
}

init();


function graphData(){
 const all=state.notes.filter(n=>!n.deleted_at&&!n.is_archived);
 const bookName=id=>state.notebooks.find(b=>b.id===id)?.name||'';
 const q=($('graph-filter')?.value||'').trim().toLocaleLowerCase('pt-BR');
 const source=q?all.filter(n=>[n.title,n.content?.slice(0,2000),bookName(n.notebook_id),...(n.tags||[])].join(' ').toLocaleLowerCase('pt-BR').includes(q)):all;
 const nodes=source.slice(0,45);
 const edges=[];
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i],b=nodes[j];
   const normalize=s=>String(s||'').trim().toLocaleLowerCase('pt-BR');
   const refs=(text,title)=>[...String(text||'').matchAll(/\[\[([^\]]+)\]\]/g)].some(m=>normalize(m[1])===normalize(title));
   let kind='';
   if(refs(a.content,b.title)||refs(b.content,a.title))kind='explicit';
   else if((a.tags||[]).some(t=>(b.tags||[]).some(v=>normalize(v)===normalize(t))))kind='tag';
   else if(a.notebook_id&&a.notebook_id===b.notebook_id)kind='book';
   if(kind)edges.push({a:i,b:j,kind});
 }
 return {nodes,edges,total:source.length};
}
function renderGraph(){
 const canvas=$('graph-canvas');if(!canvas)return;
 const {nodes,edges,total}=graphData();
 $('graph-count').textContent=`${total} ${total===1?'nota':'notas'}${total>45?' · mostrando 45':''} · ${edges.length} conexões`;
 const container=$('graph-nodes'),svg=$('graph-lines');container.replaceChildren();svg.replaceChildren();
 const w=Math.max(340,canvas.clientWidth||680),h=Math.max(420,Math.min(860,300+nodes.length*14));
 canvas.style.height=h+'px';svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 if(!nodes.length){$('graph-details').textContent='Nenhuma nota encontrada. Crie anotações ou altere a busca.';return}
 const centerX=w/2,centerY=h/2;
 const positions=nodes.map((n,i)=>{
    const angle=i*2.399963229728653;
    const r=Math.sqrt((i+.5)/nodes.length)*Math.min(w*.40,h*.41);
    return {x:centerX+Math.cos(angle)*r,y:centerY+Math.sin(angle)*r};
 });
 const ns='http://www.w3.org/2000/svg';
 edges.forEach(edge=>{const line=document.createElementNS(ns,'line');const a=positions[edge.a],b=positions[edge.b];line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);line.setAttribute('class','graph-line '+edge.kind);svg.append(line)});
 nodes.forEach((n,i)=>{const b=document.createElement('button');b.type='button';b.className='graph-node'+(n.is_pinned?' is-pinned':'');b.style.left=(positions[i].x/w*100)+'%';b.style.top=(positions[i].y/h*100)+'%';b.textContent=(n.title||'Sem título').slice(0,36);b.title=n.title||'Sem título';b.setAttribute('aria-label','Ver conexões de '+(n.title||'Sem título'));b.onclick=()=>{
   container.querySelectorAll('.is-selected').forEach(x=>x.classList.remove('is-selected'));b.classList.add('is-selected');
   const related=edges.filter(x=>x.a===i||x.b===i).map(x=>({note:nodes[x.a===i?x.b:x.a],kind:x.kind}));
   const detail=$('graph-details');detail.replaceChildren();
   const strong=document.createElement('strong');strong.textContent=n.title||'Sem título';detail.append(strong);
   const summary=document.createElement('p');summary.textContent=related.length?related.length+' conexões encontradas':'Sem conexões ainda. Use [[Título de outra nota]] ou etiquetas para conectá-la.';detail.append(summary);
   const open=document.createElement('button');open.type='button';open.className='home-outline';open.textContent='Abrir esta nota →';open.onclick=()=>selectNote(n.id);detail.append(open);
   if(related.length){const list=document.createElement('div');list.className='graph-related';related.slice(0,12).forEach(({note,kind})=>{const button=document.createElement('button');button.type='button';button.textContent=note.title+' · '+({explicit:'referência',tag:'etiqueta',book:'caderno'}[kind]);button.onclick=()=>selectNote(note.id);list.append(button)});detail.append(list)}
 };container.append(b)});
 $('graph-details').textContent='Clique em uma nota para conhecer suas conexões e abri-la.';
}
function openQuickCapture(){
 const dialog=$('quick-capture');if(dialog.open)return;
 $('quick-book').replaceChildren(new Option('Sem caderno',''));
 for(const b of state.notebooks)$('quick-book').add(new Option(b.name,b.id));
 $('quick-book').value=state.view==='notebook'&&state.notebook?state.notebook:'';
 $('quick-title-input').value='';$('quick-text').value='';dialog.showModal();$('quick-text').focus();
}
async function saveQuickCapture(e){
 e.preventDefault();const content=$('quick-text').value.trim();if(!content)return;
 const title=$('quick-title-input').value.trim()||content.split('\n')[0].slice(0,75)||'Ideia rápida';
 const button=$('quick-save');button.disabled=true;
 try{
   await flush();
   const payload={user_id:state.user.id,title,content,notebook_id:$('quick-book').value||null,tags:[]};
   const {data,error}=await supabase.from('notes').insert(payload).select().single();if(error)throw error;
   state.notes.unshift(data);$('quick-capture').close();renderSide();renderList();renderHome();notify('Ideia salva no Supabase!');
 }catch(err){notify('Falha ao salvar ideia: '+errorMessage(err));console.error(err)}finally{button.disabled=false}
}
