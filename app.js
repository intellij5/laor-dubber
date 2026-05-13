'use strict';

const TRANSFORMERS_VERSION = '2.17.2';
const TRANSFORMERS_MODULE = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${TRANSFORMERS_VERSION}`;
const TRANSFORMERS_WASM = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${TRANSFORMERS_VERSION}/dist/`;
const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const TARGET_SAMPLE_RATE = 16000;
const ASR_CHUNK_SECONDS = 30;
const AUTH_DB_KEY = 'laor-users-db-v2';
const AUTH_SESSION_KEY = 'laor-current-user-v2';
const GUEST_SESSION_VALUE = '__guest__';
const GUEST_USAGE_KEY = 'laor-guest-video-usage-v1';
const GUEST_VIDEO_LIMIT = 3;
const GUEST_MAX_VIDEO_SECONDS = 5 * 60;

const languages = {
  'Chinese (Simplified)': 'zh-CN', 'Chinese (Traditional)': 'zh-TW', Khmer: 'km', English: 'en', Japanese: 'ja', Korean: 'ko', Thai: 'th', Vietnamese: 'vi', French: 'fr', Spanish: 'es', German: 'de', Hindi: 'hi', Arabic: 'ar', Russian: 'ru', Portuguese: 'pt', Italian: 'it', Indonesian: 'id', Malay: 'ms', Filipino: 'fil', Burmese: 'my', Lao: 'lo', Bengali: 'bn', Tamil: 'ta', Telugu: 'te', Turkish: 'tr', Polish: 'pl', Dutch: 'nl', Swedish: 'sv', Czech: 'cs', Romanian: 'ro', Greek: 'el', Hebrew: 'he', Persian: 'fa', Urdu: 'ur', Nepali: 'ne', Sinhala: 'si'
};
const whisperLanguages = { 'zh-CN': 'chinese', 'zh-TW': 'chinese', km: 'khmer', en: 'english', ja: 'japanese', ko: 'korean', th: 'thai', vi: 'vietnamese', fr: 'french', es: 'spanish', de: 'german', hi: 'hindi', ar: 'arabic', ru: 'russian', pt: 'portuguese', it: 'italian', id: 'indonesian', ms: 'malay', fil: 'tagalog', my: 'burmese', lo: 'lao', bn: 'bengali', ta: 'tamil', te: 'telugu', tr: 'turkish', pl: 'polish', nl: 'dutch', sv: 'swedish', cs: 'czech', ro: 'romanian', el: 'greek', he: 'hebrew', fa: 'persian', ur: 'urdu', ne: 'nepali', si: 'sinhala' };
const $ = (id) => document.getElementById(id);
function iconSvg(name) { return `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`; }

const state = {
  segments: [], busy: false, paused: false, cancelRequested: false,
  currentVideoUrl: null, currentVideoDuration: 0, guestUsage: null,
  theme: localStorage.getItem('laor-theme') || 'dark', transcriber: null, transcriberModel: '',
  usersDb: null, currentUser: null, workspaceInitialized: false,
  voicePreviewAudio: null, voicePreviewToken: 0, edgeTtsCache: new Map()
};

const els = {
  authScreen: $('authScreen'), loginForm: $('loginForm'), loginUsername: $('loginUsername'), loginPassword: $('loginPassword'), guestAccessButton: $('guestAccessButton'), guestLimitText: $('guestLimitText'), loginError: $('loginError'), currentUserBadge: $('currentUserBadge'), adminUsersButton: $('adminUsersButton'), changePasswordButton: $('changePasswordButton'), signOutButton: $('signOutButton'), changePasswordDialog: $('changePasswordDialog'), changePasswordForm: $('changePasswordForm'), oldPassword: $('oldPassword'), newPassword: $('newPassword'), confirmNewPassword: $('confirmNewPassword'), passwordError: $('passwordError'), closePasswordDialog: $('closePasswordDialog'), adminDialog: $('adminDialog'), usersTableBody: $('usersTableBody'), addUserButton: $('addUserButton'), saveUsersButton: $('saveUsersButton'), closeAdminDialog: $('closeAdminDialog'), exportUsersButton: $('exportUsersButton'), importUsersButton: $('importUsersButton'), usersImportInput: $('usersImportInput'), themeToggle: $('themeToggle'), videoInput: $('videoInput'), srtInput: $('srtInput'), videoPath: $('videoPath'), videoPreview: $('videoPreview'), browseButton: $('browseButton'), openVideoMenu: $('openVideoMenu'), importSrtMenu: $('importSrtMenu'), exportSrtMenu: $('exportSrtMenu'), exportJsonMenu: $('exportJsonMenu'), clearTimelineMenu: $('clearTimelineMenu'), aboutMenu: $('aboutMenu'), importSrtButton: $('importSrtButton'), exportSrtButton: $('exportSrtButton'), addSentenceButton: $('addSentenceButton'), sourceLanguage: $('sourceLanguage'), targetLanguage: $('targetLanguage'), whisperModel: $('whisperModel'), transcribeButton: $('transcribeButton'), translateButton: $('translateButton'), dubButton: $('dubButton'), startButton: $('startButton'), stopButton: $('stopButton'), resumeButton: $('resumeButton'), cancelButton: $('cancelButton'), aiVoiceOnly: $('aiVoiceOnly'), tableWrap: document.querySelector('.table-wrap'), timelineBody: $('timelineBody'), progressBar: $('progressBar'), progressPercent: $('progressPercent'), statusLabel: $('statusLabel'), messageDialog: $('messageDialog'), dialogTitle: $('dialogTitle'), dialogText: $('dialogText')
};

init().catch((e) => showMessage('Startup Error', e.message || String(e)));

async function init() {
  applyTheme(state.theme);
  await initAuthDatabase();
  bindAuthEvents();
  const sessionUser = getSessionUser();
  if (sessionUser) signInToWorkspace(sessionUser); else showAuthScreen();
}
function initWorkspace() {
  if (state.workspaceInitialized) return;
  state.workspaceInitialized = true;
  populateLanguages(); populateWhisperModels(); bindEvents();
  addSegment({ start: '00:00:00.000', end: '00:00:03.000', text: '', translatedText: '', voiceGender: 'Female' });
  setProgress(0); setStatus('Ready.');
}

async function initAuthDatabase() {
  const stored = localStorage.getItem(AUTH_DB_KEY);
  if (stored) { try { state.usersDb = normalizeUsersDb(JSON.parse(stored)); return; } catch { localStorage.removeItem(AUTH_DB_KEY); } }
  try {
    const response = await fetch('users.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load users.json: ${response.status}`);
    state.usersDb = normalizeUsersDb(await response.json());
  } catch {
    state.usersDb = normalizeUsersDb({ users: [{ username: 'admin@laordubber.com', displayName: 'Administrator', role: 'admin', active: true, lifetime: true, endDate: '', passwordSalt: 'laor-admin-email-salt', passwordHash: await hashPassword('admin@laordubber.com', 'laor-admin-email-salt'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  }
  persistUsersDb();
}
function normalizeUsersDb(db) {
  return { schemaVersion: 2, users: (Array.isArray(db?.users) ? db.users : []).map((u) => ({ username: String(u.username || '').trim(), displayName: String(u.displayName || u.username || '').trim(), role: u.role === 'admin' ? 'admin' : 'user', active: u.active !== false, lifetime: u.lifetime === true, endDate: u.lifetime ? '' : String(u.endDate || '').slice(0,10), passwordSalt: String(u.passwordSalt || ''), passwordHash: String(u.passwordHash || ''), createdAt: u.createdAt || new Date().toISOString(), updatedAt: u.updatedAt || new Date().toISOString() })).filter((u) => u.username) };
}
function persistUsersDb(){ localStorage.setItem(AUTH_DB_KEY, JSON.stringify(state.usersDb, null, 2)); }
function bindAuthEvents() {
  els.loginForm.addEventListener('submit', async (e) => { e.preventDefault(); await handleLogin(); });
  els.guestAccessButton.addEventListener('click', signInAsGuest);
  els.signOutButton.addEventListener('click', signOut);
  els.adminUsersButton.addEventListener('click', openAdminDialog);
  els.changePasswordButton.addEventListener('click', openChangePasswordDialog);
  els.closePasswordDialog.addEventListener('click', () => els.changePasswordDialog.close());
  els.changePasswordForm.addEventListener('submit', async (e) => { e.preventDefault(); await changeCurrentUserPassword(); });
  els.closeAdminDialog.addEventListener('click', () => els.adminDialog.close());
  els.addUserButton.addEventListener('click', () => addUserRow());
  els.saveUsersButton.addEventListener('click', saveUsersFromAdminTable);
  els.exportUsersButton.addEventListener('click', exportUsersJson);
  els.importUsersButton.addEventListener('click', () => els.usersImportInput.click());
  els.usersImportInput.addEventListener('change', importUsersJson);
}
async function handleLogin(){
  els.loginError.textContent=''; const username=els.loginUsername.value.trim(); const password=els.loginPassword.value; const user=findUser(username);
  if(!user){ els.loginError.textContent='Invalid username or password.'; return; }
  const access=validateUserAccess(user); if(!access.ok){ els.loginError.textContent=access.message; return; }
  const hash=await hashPassword(password,user.passwordSalt); if(hash!==user.passwordHash){ els.loginError.textContent='Invalid username or password.'; return; }
  sessionStorage.setItem(AUTH_SESSION_KEY,user.username); els.loginPassword.value=''; signInToWorkspace(user);
}
function signInToWorkspace(user){ state.currentUser=user; document.body.classList.remove('auth-locked'); document.body.classList.add('auth-ready'); updateAccountActions(); initWorkspace(); setStatus(isGuestUser()?`Guest mode: ${Math.max(0,GUEST_VIDEO_LIMIT-getGuestUsage().videosUsed)} video(s) left. Max 5 minutes per video.`:`Signed in as ${user.displayName || user.username}.`); }
function updateAccountActions(){ const user=state.currentUser; const guest=isGuestUser(); const signed=Boolean(user&&!guest); const admin=signed&&user.role==='admin'; if(!user) els.currentUserBadge.textContent=''; else if(guest){ const u=getGuestUsage(); els.currentUserBadge.textContent=`Guest (${Math.max(0,GUEST_VIDEO_LIMIT-u.videosUsed)}/${GUEST_VIDEO_LIMIT} videos left)`;} else els.currentUserBadge.textContent=`${user.displayName || user.username} (${user.role})`; els.adminUsersButton.hidden=!admin; els.changePasswordButton.hidden=!signed; els.signOutButton.hidden=!user; }
function signInAsGuest(){ const u=getGuestUsage(); if(u.videosUsed>=GUEST_VIDEO_LIMIT){ els.loginError.textContent=`Guest limit reached: ${GUEST_VIDEO_LIMIT} videos already used. Please sign in.`; return;} sessionStorage.setItem(AUTH_SESSION_KEY,GUEST_SESSION_VALUE); signInToWorkspace(createGuestUser()); }
function createGuestUser(){ return { username:GUEST_SESSION_VALUE, displayName:'Guest', role:'guest', active:true, lifetime:false, endDate:''}; }
function isGuestUser(){ return state.currentUser?.role==='guest'||state.currentUser?.username===GUEST_SESSION_VALUE; }
function showAuthScreen(){ state.currentUser=null; updateAccountActions(); document.body.classList.add('auth-locked'); document.body.classList.remove('auth-ready'); updateGuestLimitText(); els.loginUsername.focus(); }
function getSessionUser(){ const username=sessionStorage.getItem(AUTH_SESSION_KEY); if(!username) return null; if(username===GUEST_SESSION_VALUE) return createGuestUser(); const user=findUser(username); if(!user||!validateUserAccess(user).ok){sessionStorage.removeItem(AUTH_SESSION_KEY);return null;} return user; }
function signOut(){ sessionStorage.removeItem(AUTH_SESSION_KEY); showAuthScreen(); }
function findUser(username){ const v=String(username||'').trim().toLowerCase(); return state.usersDb?.users.find((u)=>u.username.toLowerCase()===v)||null; }
function validateUserAccess(u){ if(!u.active) return {ok:false,message:'This account is disabled.'}; if(u.lifetime) return {ok:true,message:''}; if(!u.endDate) return {ok:false,message:'This account has no valid end date.'}; const end=new Date(`${u.endDate}T23:59:59`); if(Number.isNaN(end.getTime())) return {ok:false,message:'This account has an invalid end date.'}; if(end<new Date()) return {ok:false,message:'This account has expired.'}; return {ok:true,message:''}; }
async function hashPassword(password,salt){ if(!crypto.subtle) throw new Error('Secure password hashing requires HTTPS or localhost.'); const data=new TextEncoder().encode(`${salt}:${password}`); const digest=await crypto.subtle.digest('SHA-256',data); return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join(''); }
function makeSalt(){ const b=new Uint8Array(16); crypto.getRandomValues(b); return [...b].map((x)=>x.toString(16).padStart(2,'0')).join(''); }
function openChangePasswordDialog(){ if(isGuestUser()){ showMessage('Change Password','Guest users do not have a password.'); return;} els.passwordError.textContent=''; els.changePasswordForm.reset(); els.changePasswordDialog.showModal(); }
async function changeCurrentUserPassword(){ const user=findUser(state.currentUser?.username); if(!user){els.passwordError.textContent='Current user not found.';return;} if(await hashPassword(els.oldPassword.value,user.passwordSalt)!==user.passwordHash){els.passwordError.textContent='Old password is incorrect.';return;} if(els.newPassword.value.length<6){els.passwordError.textContent='New password must be at least 6 characters.';return;} if(els.newPassword.value!==els.confirmNewPassword.value){els.passwordError.textContent='New password and confirmation do not match.';return;} user.passwordSalt=makeSalt(); user.passwordHash=await hashPassword(els.newPassword.value,user.passwordSalt); user.updatedAt=new Date().toISOString(); persistUsersDb(); els.changePasswordDialog.close(); showMessage('Password Changed','Your password was updated.'); }
function openAdminDialog(){ if(state.currentUser?.role!=='admin')return; renderUsersTable(); els.adminDialog.showModal(); }
function renderUsersTable(){ els.usersTableBody.innerHTML=''; state.usersDb.users.forEach((u)=>addUserRow(u)); }
function addUserRow(user=null){ const tr=document.createElement('tr'); tr.dataset.originalUsername=user?.username||''; tr.innerHTML=`<td><input class="admin-username" value="${escapeAttr(user?.username||'')}" placeholder="username"></td><td><input class="admin-display" value="${escapeAttr(user?.displayName||'')}" placeholder="display name"></td><td><select class="admin-role"><option value="user">user</option><option value="admin">admin</option></select></td><td class="center"><input class="admin-active" type="checkbox" ${user?.active!==false?'checked':''}></td><td class="center"><input class="admin-lifetime" type="checkbox" ${user?.lifetime?'checked':''}></td><td><input class="admin-end" type="date" value="${escapeAttr(user?.endDate||'')}"></td><td><input class="admin-password" type="password" placeholder="leave blank to keep"></td><td><button class="btn btn-red icon-only admin-delete" type="button">${iconSvg('trash')}</button></td>`; tr.querySelector('.admin-role').value=user?.role==='admin'?'admin':'user'; const lifetime=tr.querySelector('.admin-lifetime'), end=tr.querySelector('.admin-end'); const sync=()=>{end.disabled=lifetime.checked;if(lifetime.checked)end.value='';}; lifetime.addEventListener('change',sync); sync(); tr.querySelector('.admin-delete').addEventListener('click',()=>{ const username=tr.querySelector('.admin-username').value.trim(); if(username&&username.toLowerCase()===state.currentUser.username.toLowerCase()){showMessage('User Management','You cannot delete the signed-in admin account.');return;} tr.remove();}); els.usersTableBody.appendChild(tr); }
async function saveUsersFromAdminTable(){ try{ const rows=[...els.usersTableBody.querySelectorAll('tr')]; const next=[]; const seen=new Set(); for(const row of rows){ const original=row.dataset.originalUsername||''; const existing=original?findUser(original):null; const username=row.querySelector('.admin-username').value.trim(); if(!/^[a-zA-Z0-9_.@-]{3,80}$/.test(username)) throw new Error(`Invalid username: ${username||'(blank)'}.`); const key=username.toLowerCase(); if(seen.has(key)) throw new Error(`Duplicate username: ${username}`); seen.add(key); const lifetime=row.querySelector('.admin-lifetime').checked; const endDate=lifetime?'':row.querySelector('.admin-end').value; if(!lifetime&&!endDate) throw new Error(`End date is required for ${username}, unless Lifetime is checked.`); let passwordSalt=existing?.passwordSalt||'', passwordHash=existing?.passwordHash||''; const newPassword=row.querySelector('.admin-password').value; if(newPassword){ if(newPassword.length<6) throw new Error(`Password for ${username} must be at least 6 characters.`); passwordSalt=makeSalt(); passwordHash=await hashPassword(newPassword,passwordSalt); } if(!passwordHash) throw new Error(`Password is required for new user ${username}.`); next.push({ username, displayName:row.querySelector('.admin-display').value.trim()||username, role:row.querySelector('.admin-role').value==='admin'?'admin':'user', active:row.querySelector('.admin-active').checked, lifetime, endDate, passwordSalt, passwordHash, createdAt:existing?.createdAt||new Date().toISOString(), updatedAt:new Date().toISOString() }); } if(!next.some((u)=>u.role==='admin'&&u.active)) throw new Error('At least one active admin user is required.'); state.usersDb.users=next; persistUsersDb(); state.currentUser=findUser(state.currentUser.username); updateAccountActions(); renderUsersTable(); showMessage('Users Saved','User database saved in this browser. Export JSON to update users.json in your GitHub repo.'); }catch(e){showMessage('User Management',e.message||String(e));} }
function exportUsersJson(){ downloadText('users.json',JSON.stringify(state.usersDb,null,2),'application/json;charset=utf-8'); }
async function importUsersJson(){ const file=els.usersImportInput.files?.[0]; if(!file)return; try{ const imported=normalizeUsersDb(JSON.parse(await file.text())); if(!imported.users.length) throw new Error('Imported JSON does not contain users.'); if(!imported.users.some((u)=>u.role==='admin'&&u.active)) throw new Error('Imported JSON must contain an active admin.'); state.usersDb=imported; persistUsersDb(); renderUsersTable(); setStatus('Imported users database.'); }catch(e){showMessage('Import Users JSON',e.message||String(e));} finally{els.usersImportInput.value='';} }

function bindEvents(){
  els.themeToggle.addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem('laor-theme',state.theme);applyTheme(state.theme);});
  els.browseButton.addEventListener('click',()=>els.videoInput.click()); els.openVideoMenu.addEventListener('click',()=>els.videoInput.click()); els.videoInput.addEventListener('change',handleVideoSelected);
  els.importSrtMenu.addEventListener('click',()=>els.srtInput.click()); els.importSrtButton.addEventListener('click',()=>els.srtInput.click()); els.srtInput.addEventListener('change',handleSrtSelected);
  els.exportSrtMenu.addEventListener('click',exportSrt); els.exportSrtButton.addEventListener('click',exportSrt); els.exportJsonMenu.addEventListener('click',exportJson); els.clearTimelineMenu.addEventListener('click',clearTimeline); els.aboutMenu.addEventListener('click',showAbout);
  els.addSentenceButton.addEventListener('click',()=>{ pullTableChanges(); const last=state.segments.at(-1); const start=last?last.end:'00:00:00.000'; addSegment({start,end:addSecondsToTime(start,3),text:'',translatedText:'',voiceGender:'Female'}); renderTimeline(true); });
  els.transcribeButton.addEventListener('click',()=>runExclusive(transcribeVideo)); els.translateButton.addEventListener('click',()=>runExclusive(translateTimeline)); els.dubButton.addEventListener('click',()=>runExclusive(()=>renderDubbedVideo(true))); els.startButton.addEventListener('click',()=>runExclusive(startFullPipeline)); els.stopButton.addEventListener('click',pauseOperation); els.resumeButton.addEventListener('click',resumeOperation); els.cancelButton.addEventListener('click',cancelOperation);
}
function populateLanguages(){ for(const name of Object.keys(languages)){els.sourceLanguage.append(new Option(name,name)); els.targetLanguage.append(new Option(name,name));} els.sourceLanguage.value='Chinese (Simplified)'; els.targetLanguage.value='Khmer'; }
function populateWhisperModels(){ [['Xenova/whisper-tiny','tiny - fastest'],['Xenova/whisper-base','base - better'],['Xenova/whisper-small','small - slower']].forEach(([v,l])=>els.whisperModel.append(new Option(l,v))); els.whisperModel.value='Xenova/whisper-tiny'; }
function applyTheme(theme){ document.body.classList.toggle('theme-light',theme==='light'); document.body.classList.toggle('theme-dark',theme!=='light'); els.themeToggle.innerHTML=iconSvg(theme==='light'?'sun':'moon'); }
async function handleVideoSelected(){ const file=getSelectedVideoFile(); if(!file)return; try{ const duration=await getVideoDuration(file); if(isGuestUser()){ const usage=getGuestUsage(); if(duration>GUEST_MAX_VIDEO_SECONDS){ resetSelectedVideo(); showMessage('Guest Video Limit',`Guest videos must be 5 minutes or shorter. This video is ${formatDuration(duration)}.`); return;} if(usage.videosUsed>=GUEST_VIDEO_LIMIT){ resetSelectedVideo(); showMessage('Guest Video Limit','Guest access is limited to 3 videos. Please sign in.'); updateGuestLimitText(); return;} usage.videosUsed+=1; usage.history.push({name:file.name,durationSeconds:Math.round(duration),usedAt:new Date().toISOString()}); persistGuestUsage(usage); updateGuestLimitText(); }
    if(state.currentVideoUrl) URL.revokeObjectURL(state.currentVideoUrl); state.currentVideoDuration=duration; state.currentVideoUrl=URL.createObjectURL(file); els.videoPreview.src=state.currentVideoUrl; els.videoPath.value=file.name; setStatus(`Selected video: ${file.name}`); }catch(e){ resetSelectedVideo(); showMessage('Open Video',e.message||String(e)); } }
function getSelectedVideoFile(){ return els.videoInput.files?.[0]||null; }
function getGuestUsage(){ if(state.guestUsage)return state.guestUsage; try{ const p=JSON.parse(localStorage.getItem(GUEST_USAGE_KEY)||'{}'); state.guestUsage={videosUsed:Math.max(0,Number(p.videosUsed)||0),history:Array.isArray(p.history)?p.history:[]}; }catch{ state.guestUsage={videosUsed:0,history:[]}; } return state.guestUsage; }
function persistGuestUsage(u){ state.guestUsage=u; localStorage.setItem(GUEST_USAGE_KEY,JSON.stringify(u)); }
function updateGuestLimitText(){ if(!els.guestLimitText)return; const u=getGuestUsage(); const remain=Math.max(0,GUEST_VIDEO_LIMIT-u.videosUsed); els.guestLimitText.textContent=`Guest access: ${remain}/${GUEST_VIDEO_LIMIT} videos left, maximum 5 minutes per video.`; if(isGuestUser()) updateAccountActions(); }
function resetSelectedVideo(){ if(state.currentVideoUrl)URL.revokeObjectURL(state.currentVideoUrl); state.currentVideoUrl=null; state.currentVideoDuration=0; els.videoInput.value=''; els.videoPath.value=''; els.videoPreview.removeAttribute('src'); els.videoPreview.load(); }
function getVideoDuration(file){ return new Promise((resolve,reject)=>{ const url=URL.createObjectURL(file); const v=document.createElement('video'); v.preload='metadata'; v.onloadedmetadata=()=>{ const d=v.duration; URL.revokeObjectURL(url); Number.isFinite(d)&&d>0?resolve(d):reject(new Error('Could not read video duration.')); }; v.onerror=()=>{URL.revokeObjectURL(url); reject(new Error('Could not read this video file.'));}; v.src=url; }); }
function formatDuration(seconds){ const t=Math.round(seconds); return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`; }
async function handleSrtSelected(){ const file=els.srtInput.files?.[0]; if(!file)return; const segments=parseSrt(await file.text()); if(!segments.length){showMessage('Import SRT','No valid SRT entries found.');return;} state.segments=segments; renderTimeline(true); setProgress(100); setStatus(`Imported ${segments.length} subtitle segment(s).`); els.srtInput.value=''; }
function addSegment(seg){ state.segments.push({id:state.segments.length+1,start:seg.start||'00:00:00.000',end:seg.end||'00:00:03.000',text:seg.text||'',translatedText:seg.translatedText||'',voiceGender:seg.voiceGender||'Female',translationError:''}); }
function renderTimeline(scrollToEnd=false){ els.timelineBody.innerHTML=''; state.segments.forEach((seg,i)=>{ seg.id=i+1; const tr=document.createElement('tr'); tr.dataset.index=String(i); tr.innerHTML=`<td class="row-id">${seg.id}</td><td><input class="time-input" data-field="start" value="${escapeAttr(seg.start)}"></td><td><input class="time-input" data-field="end" value="${escapeAttr(seg.end)}"></td><td><textarea data-field="text">${escapeHtml(seg.text)}</textarea></td><td><textarea data-field="translatedText" title="${escapeAttr(seg.translationError||'')}" class="${seg.translationError?'translation-warning':''}">${escapeHtml(seg.translatedText)}</textarea></td><td><select class="voice-select" data-field="voiceGender"><option>Female</option><option>Male</option></select></td><td><button class="btn btn-green play-btn icon-only" type="button" title="Preview voice">${iconSvg('play')}</button></td><td><button class="btn btn-red delete-btn icon-only" type="button" title="Delete row">${iconSvg('x')}</button></td>`; tr.querySelector('[data-field="voiceGender"]').value=seg.voiceGender||'Female'; tr.querySelector('.delete-btn').addEventListener('click',()=>{pullTableChanges(); state.segments.splice(i,1); renderTimeline(); setStatus('Timeline sentence deleted.');}); tr.querySelector('.play-btn').addEventListener('click',async()=>{pullTableChanges(); await previewTranslatedSpeech(i);}); els.timelineBody.appendChild(tr); }); if(scrollToEnd){ const last=els.timelineBody.lastElementChild; if(last) scrollTimelineRowIntoView(last); } }
function scrollTimelineRowIntoView(row){ if(!row||!els.tableWrap)return; const top=row.offsetTop,bottom=top+row.offsetHeight,viewTop=els.tableWrap.scrollTop,viewBottom=viewTop+els.tableWrap.clientHeight; if(top<viewTop)els.tableWrap.scrollTop=top; else if(bottom>viewBottom)els.tableWrap.scrollTop=bottom-els.tableWrap.clientHeight; }
function updateTimelineRow(i,scroll=false){ const seg=state.segments[i], row=els.timelineBody.querySelector(`tr[data-index="${i}"]`); if(!seg||!row){renderTimeline(scroll);return;} row.querySelector('.row-id').textContent=String(i+1); row.querySelector('[data-field="start"]').value=seg.start; row.querySelector('[data-field="end"]').value=seg.end; row.querySelector('[data-field="text"]').value=seg.text; const t=row.querySelector('[data-field="translatedText"]'); t.value=seg.translatedText; t.title=seg.translationError||''; t.classList.toggle('translation-warning',Boolean(seg.translationError)); row.querySelector('[data-field="voiceGender"]').value=seg.voiceGender||'Female'; if(scroll)scrollTimelineRowIntoView(row); }
function pullTableChanges(){ [...els.timelineBody.querySelectorAll('tr')].forEach((row,i)=>{ const seg=state.segments[i]; if(!seg)return; seg.start=row.querySelector('[data-field="start"]').value.trim(); seg.end=row.querySelector('[data-field="end"]').value.trim(); seg.text=row.querySelector('[data-field="text"]').value.trim(); const tr=row.querySelector('[data-field="translatedText"]').value.trim(); if(tr!==seg.translatedText)seg.translationError=''; seg.translatedText=tr; seg.voiceGender=row.querySelector('[data-field="voiceGender"]').value; }); }
async function previewTranslatedSpeech(i){ const seg=state.segments[i]; if(!seg)return; if(!seg.translatedText.trim()&&seg.text.trim()){ const src=normalizeGoogleCode(languages[els.sourceLanguage.value]); const tgt=normalizeGoogleCode(languages[els.targetLanguage.value]); setStatus(`Translating row ${i+1} for voice preview...`); try{seg.translatedText=await translateWithRetries(seg.text,src,tgt);seg.translationError='';updateTimelineRow(i,true);}catch(e){seg.translationError=e.message||String(e);updateTimelineRow(i,true);showMessage('Voice Preview',`Could not translate row ${i+1}.`);return;} } await speakSegment(seg); }
async function runExclusive(action){ if(state.busy){setStatus('Another operation is already running. Use Stop, Resume, or Cancel first.');return;} state.busy=true; state.paused=false; state.cancelRequested=false; setControlsBusy(true); setProgress(0); try{await action();}catch(e){ if(state.cancelRequested){setStatus('Operation cancelled.');setProgress(0);} else {console.error(e); showMessage("L'aor Dubber",e.message||String(e)); setStatus(`Error: ${e.message||e}`);} } finally{state.busy=false; state.paused=false; state.cancelRequested=false; setControlsBusy(false);} }
async function startFullPipeline(){ if(!state.segments.some((s)=>s.text.trim())) await transcribeVideo(); await translateTimeline(); await renderDubbedVideo(false); }
async function transcribeVideo(){ const file=getSelectedVideoFile(); if(!file){showMessage('Extract & Transcribe','Choose a video file first.');return;} if(isGuestUser()&&state.currentVideoDuration>GUEST_MAX_VIDEO_SECONDS){showMessage('Guest Video Limit','Guest videos must be 5 minutes or shorter.');return;} if(state.segments.some((s)=>s.text.trim())&&!confirm('Replace the current timeline with a new browser transcription?'))return; state.segments=[]; renderTimeline(); setProgress(2); setStatus('Reading video audio...'); const audio=await decodeVideoAudioToMono16k(file); throwIfCancelled(); await waitIfPaused(); const transcriber=await getTranscriber(); const sourceLang=whisperLanguages[languages[els.sourceLanguage.value]]||null; const chunkSamples=TARGET_SAMPLE_RATE*ASR_CHUNK_SECONDS; const totalChunks=Math.max(1,Math.ceil(audio.length/chunkSamples)); for(let ci=0;ci<totalChunks;ci++){ await waitIfPaused(); throwIfCancelled(); const startSample=ci*chunkSamples,endSample=Math.min(audio.length,startSample+chunkSamples); const chunk=audio.slice(startSample,endSample); const offset=startSample/TARGET_SAMPLE_RATE; const percent=30+Math.round(((ci+1)/totalChunks)*65); setStatus(`Transcribing chunk ${ci+1}/${totalChunks} (${percent}%)...`); const opts={task:'transcribe',return_timestamps:true}; if(sourceLang)opts.language=sourceLang; const result=await transcriber(chunk,opts); for(const seg of asrResultToSegments(result,offset,chunk.length/TARGET_SAMPLE_RATE)){ addSegment(seg); } renderTimeline(true); setProgress(percent); await delay(50);} if(!state.segments.length){addSegment({start:'00:00:00.000',end:msToTime(audio.length/TARGET_SAMPLE_RATE*1000),text:'',translatedText:'',voiceGender:'Female'});renderTimeline(true);setStatus('Transcription finished, but Whisper returned no text.');} else {setProgress(100);setStatus(`Transcription completed: ${state.segments.length} segment(s).`);} }
async function getTranscriber(){ const model=els.whisperModel.value||'Xenova/whisper-tiny'; if(state.transcriber&&state.transcriberModel===model)return state.transcriber; setStatus(`Loading browser Whisper model: ${model}.`); setProgress(8); const {pipeline,env}=await import(TRANSFORMERS_MODULE); env.allowLocalModels=false; env.useBrowserCache=true; env.backends.onnx.wasm.wasmPaths=TRANSFORMERS_WASM; state.transcriber=await pipeline('automatic-speech-recognition',model,{quantized:true,progress_callback:(info)=>{if(info?.status==='progress'&&Number.isFinite(info.progress)){setProgress(8+Math.round((info.progress/100)*20));setStatus(`Downloading/loading Whisper: ${Math.round(info.progress)}%`);} }}); state.transcriberModel=model; setProgress(30); setStatus('Whisper model loaded. Starting transcription...'); return state.transcriber; }
async function decodeVideoAudioToMono16k(file){ const AC=window.AudioContext||window.webkitAudioContext; if(!AC||!window.OfflineAudioContext)throw new Error('This browser does not support Web Audio extraction.'); const buf=await file.arrayBuffer(); const ac=new AC(); let decoded; try{decoded=await ac.decodeAudioData(buf.slice(0));}catch{throw new Error('Could not decode audio from this video. Try MP4/WebM with AAC/Opus audio.');}finally{if(ac.close)ac.close();} const length=Math.max(1,Math.ceil(decoded.duration*TARGET_SAMPLE_RATE)); setProgress(18); const offline=new OfflineAudioContext(1,length,TARGET_SAMPLE_RATE); const src=offline.createBufferSource(); src.buffer=decoded; src.connect(offline.destination); src.start(0); const rendered=await offline.startRendering(); setProgress(25); return Float32Array.from(rendered.getChannelData(0)); }
function asrResultToSegments(result,offset,duration){ const out=[]; for(const c of (Array.isArray(result?.chunks)?result.chunks:[])){ const text=String(c.text||'').trim(); if(!text)continue; const ts=Array.isArray(c.timestamp)?c.timestamp:[0,null]; const st=Number.isFinite(ts[0])?ts[0]:0; let en=Number.isFinite(ts[1])?ts[1]:Math.min(duration,st+3); if(en<=st)en=Math.min(duration,st+3); out.push({start:msToTime((offset+st)*1000),end:msToTime((offset+en)*1000),text,translatedText:'',voiceGender:'Female'});} if(!out.length&&result?.text?.trim())out.push({start:msToTime(offset*1000),end:msToTime((offset+duration)*1000),text:result.text.trim(),translatedText:'',voiceGender:'Female'}); return out; }
async function translateTimeline(){ pullTableChanges(); if(!state.segments.length||!state.segments.some((s)=>s.text.trim())){showMessage('Translate','Add or transcribe timeline rows first.');return;} const src=normalizeGoogleCode(languages[els.sourceLanguage.value]),tgt=normalizeGoogleCode(languages[els.targetLanguage.value]); let failed=0; for(let i=0;i<state.segments.length;i++){ await waitIfPaused(); throwIfCancelled(); const seg=state.segments[i]; const pct=calculatePercent(i+1,state.segments.length); setStatus(`Translating ${i+1}/${state.segments.length} (${pct}%)...`); try{seg.translatedText=await translateWithRetries(seg.text,src,tgt);seg.translationError='';}catch(e){failed++;seg.translatedText=seg.text;seg.translationError=e.message||'Translation failed.';} updateTimelineRow(i,true); setProgress(pct); await delay(250);} setProgress(100); setStatus(failed?`Translation completed with ${failed} fallback row(s).`:'Translation completed.'); }
async function translateWithRetries(text,src,tgt){ if(!text.trim())return''; let last=''; for(let a=1;a<=6;a++){throwIfCancelled(); await waitIfPaused(); try{const res=await requestTranslate(text,a>=4?'auto':src,tgt); if(res.trim())return res; last='Google Translate returned empty response.';}catch(e){last=e.message||String(e);} if(a<6)await delay(550*a*a);} throw new Error(last||'Google Translate failed after retries.'); }
async function requestTranslate(text,src,tgt){ const params=new URLSearchParams({client:'gtx',sl:src,tl:tgt,hl:'en',dt:'t',ie:'UTF-8',oe:'UTF-8',q:text}); const r=await fetch(`https://translate.googleapis.com/translate_a/single?${params}`,{headers:{Accept:'application/json,text/plain,*/*'}}); if(!r.ok)throw new Error(`Google Translate returned ${r.status} ${r.statusText}`); const data=await r.json(); return Array.isArray(data)&&Array.isArray(data[0])?data[0].map((p)=>Array.isArray(p)?p[0]||'':'').join(''):''; }
async function renderDubbedVideo(showDialog=true){
  pullTableChanges();
  const file=getSelectedVideoFile();
  if(!file){showMessage('Generate Dubbed Video','Choose a video file first.');return;}
  if(!state.segments.length||!state.segments.some((s)=>(s.translatedText||s.text||'').trim())){showMessage('Generate Dubbed Video','Add, transcribe, or import timeline rows first.');return;}

  const ai=els.aiVoiceOnly.checked;
  setProgress(2);
  setStatus(ai?'Preparing browser render with translated AI voice and muted original audio...':'Preparing browser render with original audio + translated AI voice...');

  const result=await renderDubbedVideoWithMediaRecorder(file,{muteOriginalAudio:ai});
  const name=`${fileBaseName(file.name)}_${ai?'dubbed_ai_voice':'dubbed_mix'}.${result.extension}`;
  downloadBlob(name,result.blob);
  setProgress(100);
  setStatus(`Generated ${name} locally in the browser without subtitles. No ffmpeg.wasm/CDN required.`);
  if(showDialog){
    showMessage('Generate Dubbed Video',`Rendered ${name} locally in the browser without subtitles. The app also tried to mix translated AI voice audio into the recording. ${ai?'Original/background audio is muted.':'Original audio is preserved when the browser allows local audio capture.'} AI voice audio is generated as MP3 buffers first, then mixed into the recording.`);
  }
}

async function renderDubbedVideoWithMediaRecorder(file,{muteOriginalAudio}){
  if(!('MediaRecorder' in window)) throw new Error('This browser does not support MediaRecorder. Try current Chrome or Edge.');
  const sourceUrl=URL.createObjectURL(file);
  const video=document.createElement('video');
  video.src=sourceUrl;
  video.playsInline=true;
  video.preload='auto';
  video.crossOrigin='anonymous';
  video.muted=muteOriginalAudio;
  video.volume=muteOriginalAudio?0:1;

  try{
    await waitForMediaEvent(video,'loadedmetadata',15000,'Could not read video metadata.');
    const sourceWidth=video.videoWidth||1280;
    const sourceHeight=video.videoHeight||720;
    const maxWidth=1280;
    const scale=Math.min(1,maxWidth/sourceWidth);
    const width=Math.max(2,Math.round(sourceWidth*scale));
    const height=Math.max(2,Math.round(sourceHeight*scale));

    const canvas=document.createElement('canvas');
    canvas.width=width;
    canvas.height=height;
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx) throw new Error('Could not create browser canvas renderer.');

    const fps=30;
    const stream=canvas.captureStream(fps);
    let audioMixer=null;
    try{
      audioMixer=await createDubbedAudioMixer(video,{includeOriginalAudio:!muteOriginalAudio});
      for(const track of audioMixer.tracks) stream.addTrack(track);
    }catch(e){
      console.warn('AI/original audio mixer failed:',e);
      setStatus('Online AI voice failed. Using offline generated voice fallback and original audio if available...');
      try{
        video.muted=false;
        video.volume=1;
        const audioTracks=await createOriginalAudioTracks(video);
        for(const track of audioTracks) stream.addTrack(track);
        audioMixer={audioContext:audioTracks.audioContext||null,tick(){},stop(){}};
      }catch(originalError){
        console.warn('Original audio capture failed:',originalError);
        setStatus('Could not add AI voice or original audio. Browser recorded video only.');
      }
    }

    const {mimeType,extension}=chooseRecorderType();
    const chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:5000000,audioBitsPerSecond:128000});
    recorder.ondataavailable=(event)=>{if(event.data&&event.data.size)chunks.push(event.data);};

    const done=new Promise((resolve,reject)=>{
      recorder.onerror=()=>reject(recorder.error||new Error('Browser video recorder failed.'));
      recorder.onstop=()=>resolve();
    });

    const renderLoop=()=>{
      if(state.cancelRequested||video.ended||video.paused) return;
      drawVideoFrameOnly(ctx,video,width,height);
      if(audioMixer&&audioMixer.tick) audioMixer.tick(video.currentTime);
      const duration=video.duration||state.currentVideoDuration||1;
      setProgress(Math.min(98,8+Math.round((video.currentTime/duration)*88)));
      requestAnimationFrame(renderLoop);
    };

    video.currentTime=0;
    recorder.start(1000);
    await video.play();
    if(audioMixer&&audioMixer.start) await audioMixer.start();
    else if(audioMixer&&audioMixer.resume) await audioMixer.resume();
    renderLoop();

    await waitForVideoEndOrCancel(video);
    if(recorder.state!=='inactive') recorder.stop();
    await done;
    if(audioMixer&&audioMixer.stop) audioMixer.stop();
    if(audioMixer&&audioMixer.audioContext&&audioMixer.audioContext.close) await audioMixer.audioContext.close().catch(()=>{});

    if(state.cancelRequested) throw new Error('Operation cancelled.');
    if(!chunks.length) throw new Error('Browser recorder produced no video data.');
    return {blob:new Blob(chunks,{type:mimeType}),extension};
  }finally{
    try{video.pause();}catch{}
    URL.revokeObjectURL(sourceUrl);
  }
}

function chooseRecorderType(){
  const candidates=[
    ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','mp4'],
    ['video/mp4','mp4'],
    ['video/webm;codecs=vp9,opus','webm'],
    ['video/webm;codecs=vp8,opus','webm'],
    ['video/webm','webm']
  ];
  for(const [mimeType,extension] of candidates){
    if(MediaRecorder.isTypeSupported(mimeType)) return {mimeType,extension};
  }
  throw new Error('This browser cannot record MP4/WebM video. Try Chrome or Edge.');
}

async function createOriginalAudioTracks(video){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return [];
  const audioContext=new AC();
  const source=audioContext.createMediaElementSource(video);
  const destination=audioContext.createMediaStreamDestination();
  source.connect(destination);
  const tracks=destination.stream.getAudioTracks();
  tracks.audioContext=audioContext;
  return tracks;
}

async function createDubbedAudioMixer(video,{includeOriginalAudio}){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) throw new Error('This browser does not support Web Audio mixing.');
  const audioContext=new AC();
  const destination=audioContext.createMediaStreamDestination();
  const scheduledItems=[];
  const scheduledSources=[];

  if(includeOriginalAudio){
    try{
      const videoSource=audioContext.createMediaElementSource(video);
      videoSource.connect(destination);
    }catch(e){
      console.warn('Original audio mix failed:',e);
    }
  }

  const targetCode=normalizeGoogleCode(languages[els.targetLanguage.value]);
  const voiceSegments=state.segments
    .map((seg)=>({
      text:String(seg.translatedText||seg.text||'').trim(),
      startSeconds:Math.max(0,timeToMs(seg.start)/1000),
      gender:seg.voiceGender||'Female'
    }))
    .filter((item)=>item.text);

  for(let i=0;i<voiceSegments.length;i++){
    throwIfCancelled();
    await waitIfPaused();
    const item=voiceSegments[i];
    const pct=8+Math.round(((i+1)/Math.max(1,voiceSegments.length))*18);
    setProgress(Math.min(28,pct));
    setStatus(`Generating AI voice ${i+1}/${voiceSegments.length} for final video...`);
    const buffer=await synthesizeEdgeTtsAudioBuffer(audioContext,item.text,targetCode,item.gender);
    scheduledItems.push({...item,buffer});
  }

  const tracks=destination.stream.getAudioTracks();
  if(!tracks.length) throw new Error('No browser audio track could be created.');

  return {
    tracks,
    audioContext,
    async start(){
      if(audioContext.state==='suspended') await audioContext.resume();
      const base=audioContext.currentTime+0.12;
      for(const item of scheduledItems){
        const source=audioContext.createBufferSource();
        source.buffer=item.buffer;
        source.connect(destination);
        source.start(base+item.startSeconds);
        scheduledSources.push(source);
      }
    },
    tick(){},
    stop(){
      for(const source of scheduledSources){
        try{source.stop();}catch{}
      }
    }
  };
}

async function synthesizeEdgeTtsAudioBuffer(audioContext,text,targetCode,gender){
  const voiceInfo=getEdgeTtsVoice(targetCode,gender);
  const cacheKey=`${voiceInfo.voice}|${text}`;
  if(state.edgeTtsCache.has(cacheKey)){
    return cloneAudioBufferForContext(audioContext,state.edgeTtsCache.get(cacheKey));
  }

  try{
    const chunks=chunkTextForTts(text,230);
    const decodedBuffers=[];
    for(let i=0;i<chunks.length;i++){
      throwIfCancelled();
      setStatus(`Generating AI voice audio ${i+1}/${chunks.length} with ${voiceInfo.voice}...`);
      const audioBytes=await fetchEdgeTtsAudioBytes(chunks[i],voiceInfo);
      decodedBuffers.push(await audioContext.decodeAudioData(audioBytes.slice(0)));
      await delay(80);
    }
    const merged=mergeAudioBuffers(audioContext,decodedBuffers);
    state.edgeTtsCache.set(cacheKey,extractAudioBufferData(merged));
    return merged;
  }catch(error){
    console.warn('Edge TTS voice generation failed, using offline fallback voice:',error);
    setStatus('Online AI voice was blocked. Using offline generated voice so final video has sound...');
    const fallback=createOfflineVoiceBuffer(audioContext,text,gender);
    state.edgeTtsCache.set(cacheKey,extractAudioBufferData(fallback));
    return fallback;
  }
}

function extractAudioBufferData(buffer){
  const channels=[];
  for(let channel=0;channel<buffer.numberOfChannels;channel++){
    channels.push(Float32Array.from(buffer.getChannelData(channel)));
  }
  return {sampleRate:buffer.sampleRate,numberOfChannels:buffer.numberOfChannels,length:buffer.length,channels};
}

function cloneAudioBufferForContext(audioContext,data){
  const buffer=audioContext.createBuffer(data.numberOfChannels,data.length,data.sampleRate);
  for(let channel=0;channel<data.numberOfChannels;channel++){
    buffer.copyToChannel(data.channels[channel],channel);
  }
  return buffer;
}

function mergeAudioBuffers(audioContext,buffers){
  if(!buffers.length) return createOfflineVoiceBuffer(audioContext,' ', 'Female');
  if(buffers.length===1) return buffers[0];
  const channels=Math.max(...buffers.map((buffer)=>buffer.numberOfChannels));
  const sampleRate=audioContext.sampleRate;
  const totalLength=buffers.reduce((sum,buffer)=>sum+Math.ceil(buffer.duration*sampleRate),0);
  const output=audioContext.createBuffer(channels,totalLength,sampleRate);
  let offset=0;
  for(const buffer of buffers){
    const length=Math.ceil(buffer.duration*sampleRate);
    for(let ch=0;ch<channels;ch++){
      const out=output.getChannelData(ch);
      const input=buffer.getChannelData(Math.min(ch,buffer.numberOfChannels-1));
      if(buffer.sampleRate===sampleRate){
        out.set(input,offset);
      }else{
        for(let i=0;i<length;i++){
          const sourceIndex=Math.min(input.length-1,Math.floor(i*buffer.sampleRate/sampleRate));
          out[offset+i]=input[sourceIndex]||0;
        }
      }
    }
    offset+=length;
  }
  return output;
}

function createOfflineVoiceBuffer(audioContext,text,gender='Female'){
  const sampleRate=audioContext.sampleRate;
  const clean=String(text||'').trim() || 'voice';
  const duration=Math.min(24,Math.max(1.4,clean.length*0.095));
  const length=Math.ceil(duration*sampleRate);
  const buffer=audioContext.createBuffer(1,length,sampleRate);
  const data=buffer.getChannelData(0);
  const base=gender==='Male'?118:185;
  const charStep=Math.max(0.055,Math.min(0.14,duration/Math.max(1,clean.length)));
  let phase1=0, phase2=0, phase3=0;
  for(let i=0;i<length;i++){
    const t=i/sampleRate;
    const charIndex=Math.min(clean.length-1,Math.floor(t/charStep));
    const code=clean.charCodeAt(charIndex)||97;
    const syllable=Math.floor(t/charStep);
    const f0=base+(code%17)*4+(syllable%5)*7;
    const f1=f0*2.05+(code%11)*11;
    const f2=f0*3.15+(code%7)*17;
    phase1+=2*Math.PI*f0/sampleRate;
    phase2+=2*Math.PI*f1/sampleRate;
    phase3+=2*Math.PI*f2/sampleRate;
    const local=(t%charStep)/charStep;
    const env=Math.sin(Math.PI*Math.min(1,local))*0.18;
    const wordPulse=0.75+0.25*Math.sin(2*Math.PI*4.5*t);
    data[i]=(Math.sin(phase1)*0.62+Math.sin(phase2)*0.25+Math.sin(phase3)*0.13)*env*wordPulse;
  }
  return buffer;
}

function getEdgeTtsVoice(code,gender='Female'){
  const normalized=normalizeGoogleCode(code);
  const map={
    'km':{locale:'km-KH',Female:'km-KH-SreymomNeural',Male:'km-KH-PisethNeural'},
    'zh-CN':{locale:'zh-CN',Female:'zh-CN-XiaoxiaoNeural',Male:'zh-CN-YunxiNeural'},
    'zh-TW':{locale:'zh-TW',Female:'zh-TW-HsiaoChenNeural',Male:'zh-TW-YunJheNeural'},
    'en':{locale:'en-US',Female:'en-US-JennyNeural',Male:'en-US-GuyNeural'},
    'ja':{locale:'ja-JP',Female:'ja-JP-NanamiNeural',Male:'ja-JP-KeitaNeural'},
    'ko':{locale:'ko-KR',Female:'ko-KR-SunHiNeural',Male:'ko-KR-InJoonNeural'},
    'th':{locale:'th-TH',Female:'th-TH-PremwadeeNeural',Male:'th-TH-NiwatNeural'},
    'vi':{locale:'vi-VN',Female:'vi-VN-HoaiMyNeural',Male:'vi-VN-NamMinhNeural'},
    'fr':{locale:'fr-FR',Female:'fr-FR-DeniseNeural',Male:'fr-FR-HenriNeural'},
    'es':{locale:'es-ES',Female:'es-ES-ElviraNeural',Male:'es-ES-AlvaroNeural'},
    'de':{locale:'de-DE',Female:'de-DE-KatjaNeural',Male:'de-DE-ConradNeural'},
    'hi':{locale:'hi-IN',Female:'hi-IN-SwaraNeural',Male:'hi-IN-MadhurNeural'},
    'ar':{locale:'ar-SA',Female:'ar-SA-ZariyahNeural',Male:'ar-SA-HamedNeural'},
    'ru':{locale:'ru-RU',Female:'ru-RU-SvetlanaNeural',Male:'ru-RU-DmitryNeural'},
    'pt':{locale:'pt-BR',Female:'pt-BR-FranciscaNeural',Male:'pt-BR-AntonioNeural'},
    'it':{locale:'it-IT',Female:'it-IT-ElsaNeural',Male:'it-IT-DiegoNeural'},
    'id':{locale:'id-ID',Female:'id-ID-GadisNeural',Male:'id-ID-ArdiNeural'},
    'ms':{locale:'ms-MY',Female:'ms-MY-YasminNeural',Male:'ms-MY-OsmanNeural'},
    'tl':{locale:'fil-PH',Female:'fil-PH-BlessicaNeural',Male:'fil-PH-AngeloNeural'},
    'my':{locale:'my-MM',Female:'my-MM-NilarNeural',Male:'my-MM-ThihaNeural'},
    'lo':{locale:'lo-LA',Female:'lo-LA-KeomanyNeural',Male:'lo-LA-ChanthavongNeural'},
    'bn':{locale:'bn-IN',Female:'bn-IN-TanishaaNeural',Male:'bn-IN-BashkarNeural'},
    'ta':{locale:'ta-IN',Female:'ta-IN-PallaviNeural',Male:'ta-IN-ValluvarNeural'},
    'te':{locale:'te-IN',Female:'te-IN-ShrutiNeural',Male:'te-IN-MohanNeural'},
    'tr':{locale:'tr-TR',Female:'tr-TR-EmelNeural',Male:'tr-TR-AhmetNeural'},
    'pl':{locale:'pl-PL',Female:'pl-PL-ZofiaNeural',Male:'pl-PL-MarekNeural'},
    'nl':{locale:'nl-NL',Female:'nl-NL-FennaNeural',Male:'nl-NL-MaartenNeural'},
    'sv':{locale:'sv-SE',Female:'sv-SE-SofieNeural',Male:'sv-SE-MattiasNeural'},
    'cs':{locale:'cs-CZ',Female:'cs-CZ-VlastaNeural',Male:'cs-CZ-AntoninNeural'},
    'ro':{locale:'ro-RO',Female:'ro-RO-AlinaNeural',Male:'ro-RO-EmilNeural'},
    'el':{locale:'el-GR',Female:'el-GR-AthinaNeural',Male:'el-GR-NestorasNeural'},
    'he':{locale:'he-IL',Female:'he-IL-HilaNeural',Male:'he-IL-AvriNeural'},
    'fa':{locale:'fa-IR',Female:'fa-IR-DilaraNeural',Male:'fa-IR-FaridNeural'},
    'ur':{locale:'ur-PK',Female:'ur-PK-UzmaNeural',Male:'ur-PK-AsadNeural'},
    'ne':{locale:'ne-NP',Female:'ne-NP-HemkalaNeural',Male:'ne-NP-SagarNeural'},
    'si':{locale:'si-LK',Female:'si-LK-ThiliniNeural',Male:'si-LK-SameeraNeural'}
  };
  const entry=map[normalized]||map.en;
  return {locale:entry.locale,voice:entry[gender==='Male'?'Male':'Female']||entry.Female};
}

async function fetchEdgeTtsAudioBytes(text,voiceInfo){
  const requestId=crypto.randomUUID().replaceAll('-','');
  const wsUrl=await buildEdgeTtsWebSocketUrl(requestId);

  return await new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsUrl);
    ws.binaryType='arraybuffer';
    const chunks=[];
    let settled=false;
    const finish=(fn,value)=>{
      if(settled) return;
      settled=true;
      clearTimeout(timeout);
      try{ws.close();}catch{}
      fn(value);
    };
    const timeout=setTimeout(()=>{
      finish(reject,new Error('Edge TTS timed out while generating voice audio.'));
    },60000);

    ws.onopen=()=>{
      const config={context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'false'},outputFormat:'audio-24khz-48kbitrate-mono-mp3'}}}};
      ws.send(edgeHeaders({'X-RequestId':requestId,'Content-Type':'application/json; charset=utf-8','Path':'speech.config'})+JSON.stringify(config));
      const ssml=`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voiceInfo.locale}"><voice name="${voiceInfo.voice}"><prosody rate="+0%" pitch="+0Hz">${escapeXml(text)}</prosody></voice></speak>`;
      ws.send(edgeHeaders({'X-RequestId':requestId,'Content-Type':'application/ssml+xml','Path':'ssml'})+ssml);
    };
    ws.onerror=()=>{
      finish(reject,new Error('Edge TTS WebSocket failed. Browser, firewall, or network may be blocking the voice service.'));
    };
    ws.onmessage=(event)=>{
      if(typeof event.data==='string'){
        if(event.data.includes('Path:turn.end')){
          const merged=concatArrayBuffers(chunks);
          if(!merged.byteLength) finish(reject,new Error('Edge TTS returned no audio data.'));
          else finish(resolve,merged);
        }
        return;
      }
      const audio=extractEdgeAudioPayload(event.data);
      if(audio&&audio.byteLength) chunks.push(audio);
    };
    ws.onclose=()=>{
      if(settled) return;
      const merged=concatArrayBuffers(chunks);
      if(merged.byteLength) finish(resolve,merged);
      else finish(reject,new Error('Edge TTS closed before returning audio.'));
    };
  });
}

async function buildEdgeTtsWebSocketUrl(connectionId){
  const params=new URLSearchParams({
    TrustedClientToken:EDGE_TTS_TOKEN,
    ConnectionId:connectionId
  });
  try{
    const security=await createEdgeSecurityParams();
    params.set('Sec-MS-GEC',security.gec);
    params.set('Sec-MS-GEC-Version',security.version);
  }catch(error){
    console.warn('Could not create Edge TTS security params; trying legacy token only:',error);
  }
  return `${EDGE_TTS_URL}?${params.toString()}`;
}

async function createEdgeSecurityParams(){
  const winEpochOffset=11644473600;
  const ticksPerSecond=10000000;
  const trustedToken=EDGE_TTS_TOKEN;
  const nowSeconds=Math.floor(Date.now()/1000)+winEpochOffset;
  let ticks=nowSeconds*ticksPerSecond;
  ticks-=ticks%3000000000;
  const gec=(await sha256Hex(`${ticks}${trustedToken}`)).toUpperCase();
  return {gec,version:'1-130.0.2849.68'};
}

async function sha256Hex(value){
  const data=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,'0')).join('');
}


function edgeHeaders(headers){
  const time=new Date().toISOString();
  const lines=[`X-Timestamp:${time}`];
  for(const [key,value] of Object.entries(headers)) lines.push(`${key}:${value}`);
  return lines.join('\r\n')+'\r\n\r\n';
}

function extractEdgeAudioPayload(data){
  const bytes=new Uint8Array(data);
  if(bytes.length<4) return new ArrayBuffer(0);
  const headerLength=(bytes[0]<<8)|bytes[1];
  if(headerLength>0 && headerLength+2<bytes.length){
    return bytes.slice(headerLength+2).buffer;
  }
  for(let i=0;i<bytes.length-3;i++){
    if(bytes[i]===13&&bytes[i+1]===10&&bytes[i+2]===13&&bytes[i+3]===10){
      return bytes.slice(i+4).buffer;
    }
  }
  return bytes.buffer;
}

function concatArrayBuffers(buffers){
  const total=buffers.reduce((sum,buf)=>sum+buf.byteLength,0);
  const out=new Uint8Array(total);
  let offset=0;
  for(const buf of buffers){
    out.set(new Uint8Array(buf),offset);
    offset+=buf.byteLength;
  }
  return out.buffer;
}

function escapeXml(value){
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&apos;');
}

function drawVideoFrameOnly(ctx,video,width,height){
  ctx.drawImage(video,0,0,width,height);
}

function getActiveCaption(currentSeconds){
  for(const seg of state.segments){
    const start=timeToMs(seg.start)/1000;
    const end=timeToMs(seg.end)/1000;
    if(currentSeconds>=start&&currentSeconds<=end){
      return String(seg.translatedText||seg.text||'').trim();
    }
  }
  return '';
}

function wrapCanvasText(ctx,text,maxWidth,font){
  ctx.font=font;
  const words=String(text).replace(/\s+/g,' ').trim().split(' ');
  const lines=[];
  let line='';
  for(const word of words){
    const test=line?`${line} ${word}`:word;
    if(ctx.measureText(test).width>maxWidth&&line){
      lines.push(line);
      line=word;
    }else{
      line=test;
    }
  }
  if(line) lines.push(line);
  if(lines.length<=2) return lines;
  return [lines.slice(0,-1).join(' '),lines.at(-1)].slice(0,2);
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function waitForMediaEvent(element,eventName,timeoutMs,message){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>cleanup(reject,new Error(message||`Timed out waiting for ${eventName}.`)),timeoutMs);
    const onEvent=()=>cleanup(resolve);
    const onError=()=>cleanup(reject,new Error(message||`Media error while waiting for ${eventName}.`));
    const cleanup=(fn,value)=>{
      clearTimeout(timer);
      element.removeEventListener(eventName,onEvent);
      element.removeEventListener('error',onError);
      fn(value);
    };
    element.addEventListener(eventName,onEvent,{once:true});
    element.addEventListener('error',onError,{once:true});
  });
}

function waitForVideoEndOrCancel(video){
  return new Promise((resolve,reject)=>{
    const tick=()=>{
      if(state.cancelRequested){reject(new Error('Operation cancelled.'));return;}
      if(video.ended){resolve();return;}
      setTimeout(tick,250);
    };
    tick();
  });
}

async function speakSegment(seg){ const text=String(seg.translatedText||seg.text||'').trim(); if(!text)return; const target=normalizeGoogleCode(languages[els.targetLanguage.value]); const lang=normalizeSpeechLang(target); const token=++state.voicePreviewToken; stopCurrentVoicePreview(); const voice=await findBrowserVoice(lang,seg.voiceGender||'Female'); if(target==='km'||!voice){await playGoogleTranslateTts(text,target,token);return;} await speakWithBrowserVoice(text,lang,voice,token); }
function stopCurrentVoicePreview(){ try{window.speechSynthesis?.cancel?.();}catch{} if(state.voicePreviewAudio){try{state.voicePreviewAudio.pause();state.voicePreviewAudio.currentTime=0;}catch{} state.voicePreviewAudio=null;} }
async function findBrowserVoice(lang,gender){ if(!('speechSynthesis'in window))return null; const voices=await getBrowserVoices(); const root=lang.split('-')[0].toLowerCase(); const match=voices.filter((v)=>String(v.lang||'').toLowerCase().startsWith(root)); if(!match.length)return null; const hint=gender==='Male'?/(male|guy|david|mark|paul|daniel|george|yunxi|piseth|sok|rith)/i:/(female|jenny|zira|susan|aria|xiaoxiao|sreymom|srey|mom)/i; return match.find((v)=>hint.test(v.name))||match[0]; }
async function getBrowserVoices(){ if(!('speechSynthesis'in window))return[]; const v=speechSynthesis.getVoices(); if(v.length)return v; return new Promise((resolve)=>{const done=()=>{clearTimeout(timer);speechSynthesis.removeEventListener?.('voiceschanged',done);resolve(speechSynthesis.getVoices());}; const timer=setTimeout(done,700); speechSynthesis.addEventListener?.('voiceschanged',done,{once:true});}); }
function speakWithBrowserVoice(text,lang,voice,token){ return new Promise((resolve,reject)=>{ const u=new SpeechSynthesisUtterance(text); u.lang=lang; u.voice=voice; u.onstart=()=>setStatus(`Speaking translated text in ${els.targetLanguage.value}...`); u.onend=()=>{if(token===state.voicePreviewToken)setStatus('Voice preview finished.');resolve();}; u.onerror=()=>reject(new Error('Browser voice failed.')); speechSynthesis.cancel(); speechSynthesis.speak(u); }).catch(async()=>{ if(token===state.voicePreviewToken) await playGoogleTranslateTts(text,normalizeGoogleCode(languages[els.targetLanguage.value]),token); }); }
async function playGoogleTranslateTts(text,target,token){ const chunks=chunkTextForTts(text,180); for(let i=0;i<chunks.length;i++){ if(token!==state.voicePreviewToken)return; setStatus(`Speaking translated text (${i+1}/${chunks.length})...`); const audio=new Audio(buildGoogleTtsUrl(chunks[i],target)); audio.preload='auto'; state.voicePreviewAudio=audio; await playAudio(audio);} if(token===state.voicePreviewToken){state.voicePreviewAudio=null;setStatus('Voice preview finished.');} }
function buildGoogleTtsUrl(text,target){ return 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob'+`&tl=${encodeURIComponent(normalizeGoogleCode(target))}&q=${encodeURIComponent(text)}`; }
function playAudio(audio){ return new Promise((resolve,reject)=>{audio.onended=()=>resolve();audio.onerror=()=>reject(new Error('Could not play translated voice audio.')); const p=audio.play(); if(p&&p.catch)p.catch(reject);}); }
function chunkTextForTts(text,max=180){ let t=String(text||'').replace(/\s+/g,' ').trim(); const chunks=[]; while(t.length>max){let split=Math.max(t.lastIndexOf(' ',max),t.lastIndexOf('។',max),t.lastIndexOf('.',max),t.lastIndexOf('?',max),t.lastIndexOf('!',max),t.lastIndexOf(',',max)); if(split<Math.floor(max*.45))split=max; chunks.push(t.slice(0,split+1).trim()); t=t.slice(split+1).trim();} if(t)chunks.push(t); return chunks; }
function parseSrt(text){ const blocks=text.replace(/\r/g,'').trim().split(/\n{2,}/); const out=[]; for(const b of blocks){const lines=b.split('\n').map((l)=>l.trim()).filter(Boolean); const tl=lines.find((l)=>l.includes('-->')); if(!tl)continue; const idx=lines.indexOf(tl); const [st,en]=tl.split('-->').map((v)=>v.trim()); out.push({id:out.length+1,start:normalizeTime(st),end:normalizeTime(en),text:lines.slice(idx+1).join('\n'),translatedText:'',voiceGender:'Female',translationError:''});} return out; }
function exportSrt(){ pullTableChanges(); if(!state.segments.length){showMessage('Export SRT','There are no segments to export.');return;} const content=segmentsToSrt(state.segments); downloadText('laor_dubber_subtitles.srt',content,'text/plain;charset=utf-8'); setStatus('SRT exported.'); }
function exportJson(filename='laor_dubber_project.json'){ pullTableChanges(); const payload={app:"L'aor Dubber Web",version:'2.9.0-ai-voice-retry-fallback',sourceLanguage:els.sourceLanguage.value,targetLanguage:els.targetLanguage.value,whisperModel:els.whisperModel.value,aiVoiceOnly:els.aiVoiceOnly.checked,segments:state.segments}; downloadText(filename,JSON.stringify(payload,null,2),'application/json;charset=utf-8'); setStatus(`${filename} exported.`); }
function clearTimeline(){ if(!state.segments.length||confirm('Clear all timeline segments?')){state.segments=[];renderTimeline();setProgress(0);setStatus('Timeline cleared.');} }
function pauseOperation(){ if(!state.busy)return; state.paused=true; setStatus('Stopped/paused. Current chunk may finish first.'); setControlsBusy(true); }
function resumeOperation(){ if(!state.busy)return; state.paused=false; setStatus('Resumed.'); setControlsBusy(true); }
function cancelOperation(){ if(!state.busy)return; state.cancelRequested=true; state.paused=false; stopCurrentVoicePreview(); setStatus('Cancelling...'); setControlsBusy(true); }
function setControlsBusy(busy){ [els.browseButton,els.transcribeButton,els.translateButton,els.dubButton,els.addSentenceButton,els.importSrtButton,els.exportSrtButton,els.openVideoMenu,els.importSrtMenu,els.exportSrtMenu,els.exportJsonMenu,els.clearTimelineMenu,els.sourceLanguage,els.targetLanguage,els.whisperModel].forEach((el)=>{if(el)el.disabled=busy;}); els.startButton.disabled=busy; els.stopButton.disabled=!busy||state.paused; els.resumeButton.disabled=!busy||!state.paused; els.cancelButton.disabled=!busy; }
async function waitIfPaused(){ while(state.paused&&!state.cancelRequested)await delay(180); }
function throwIfCancelled(){ if(state.cancelRequested)throw new Error('Operation cancelled.'); }
function setProgress(v){ const p=Math.max(0,Math.min(100,Math.round(v))); els.progressBar.value=p; els.progressPercent.textContent=`${p}%`; }
function setStatus(m){ els.statusLabel.textContent=m; }
function calculatePercent(done,total){ return total?Math.max(0,Math.min(100,Math.round(done/total*100))):0; }
function normalizeGoogleCode(code){ if(code==='fil')return'tl'; if(code==='zh-CN'||code==='zh-TW')return code; return code.includes('-')?code.split('-')[0]:code; }
function normalizeSpeechLang(code){ const map={km:'km-KH',en:'en-US',ja:'ja-JP',ko:'ko-KR',th:'th-TH',vi:'vi-VN',zh:'zh-CN'}; if(code==='zh-CN'||code==='zh-TW')return code; return map[code]||code; }
function normalizeTime(v){ return String(v).replace(',','.'); } function toSrtTime(v){ return normalizeTime(v).replace('.',','); }
function addSecondsToTime(v,sec){ return msToTime(timeToMs(v)+sec*1000); }
function timeToMs(v){ const p=normalizeTime(v).split(':'); if(p.length!==3)return 0; const [h,m,ss]=p; const [s,ms='0']=ss.split('.'); return Number(h)*3600000+Number(m)*60000+Number(s)*1000+Number(ms.padEnd(3,'0').slice(0,3)); }
function msToTime(ms){ const safe=Math.max(0,Math.round(ms)); const h=Math.floor(safe/3600000),m=Math.floor((safe%3600000)/60000),s=Math.floor((safe%60000)/1000),mi=safe%1000; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(mi).padStart(3,'0')}`; }
function delay(ms){ return new Promise((r)=>setTimeout(r,ms)); }
function formatBytes(bytes){ if(!Number.isFinite(bytes)||bytes<=0)return '0 B'; const units=['B','KB','MB','GB']; let v=bytes,i=0; while(v>=1024&&i<units.length-1){v/=1024;i++;} return `${v.toFixed(v>=10||i===0?0:1)} ${units[i]}`; }

function fileBaseName(filename){
  return String(filename || 'video')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'video';
}

function downloadText(filename,content,mime){ downloadBlob(filename,new Blob([content],{type:mime})); }
function downloadBlob(filename,blob){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function showAbout(){ const user=state.currentUser; const guest=isGuestUser(); const access=guest?`Guest access: ${Math.max(0,GUEST_VIDEO_LIMIT-getGuestUsage().videosUsed)}/${GUEST_VIDEO_LIMIT} videos left, max 5 minutes per video.`:`Signed in as: ${user?.displayName||user?.username}\nRole: ${user?.role||'unknown'}${user?.lifetime?'\nAccess: Lifetime':user?.endDate?`\nAccess until: ${user.endDate}`:''}`; showMessage("About L'aor Dubber Web",`What this tool does:\n• Transcribes video audio in the browser with Whisper/WebAssembly.\n• Translates timeline text.\n• Previews translated speech, including Khmer fallback voice.\n• Renders a downloadable dubbed video in the browser without ffmpeg.wasm and without subtitles burned into the video.\n\n${access}`); }
function showMessage(title,message){ els.dialogTitle.textContent=title; els.dialogText.textContent=message; if(typeof els.messageDialog.showModal==='function')els.messageDialog.showModal(); else alert(`${title}\n\n${message}`); }
function escapeHtml(v){ return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); } function escapeAttr(v){ return escapeHtml(v).replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
