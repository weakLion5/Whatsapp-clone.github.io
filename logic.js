// =======================================================
// 1. IMPORT FIREBASE (JANGAN DIUBAH KECUALI VERSI)
// =======================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-auth.js";
import { getDatabase, ref, push, set, update, remove, onValue, onChildAdded, onChildChanged, onChildRemoved, get, serverTimestamp, off } from "https://www.gstatic.com/firebasejs/9.17.1/firebase-database.js";

// =======================================================
// 2. KONFIGURASI (WAJIB ISI API KEY KAMU DI SINI!)
// =======================================================
const firebaseConfig = {
    apiKey: "AIzaSyDHd3g5X-nJpeW5bvd4tdCp1fdv8nvqsn4",
    authDomain: "whatsapp-clone-e158f.firebaseapp.com",
    projectId: "whatsapp-clone-e158f",
    storageBucket: "whatsapp-clone-e158f.firebasestorage.app",
    messagingSenderId: "544454324372",
    appId: "1:544454324372:web:011c4b6ddaa3d053318481",
    databaseURL: "https://whatsapp-clone-e158f-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Inisialisasi
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

// =======================================================
// 3. VARIABEL GLOBAL
// =======================================================
let myUID = null;
let activeFriendUID = null;
let currentRoomID = null;

let globalUsersData = {};       // Cache data user (Avatar, Nama Asli)
let globalPreferences = {};     // Cache data Pin & Nickname Custom
let userUnreadCounts = {};      // Cache unread

let isReplying = false;
let replyData = null;
let isEditing = false;
let selectedMsgID = null;
let selectedMsgData = null;

let mediaRecorder = null;
let audioChunks = [];
let typingTimeout = null;

// =======================================================
// 4. AUTHENTICATION (LOGIN/LOGOUT)
// =======================================================
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');

document.getElementById('btn-google-login').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(err => alert("Login Gagal: " + err.message));
});

document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm("Yakin ingin keluar?")) signOut(auth).then(() => location.reload());
});

onAuthStateChanged(auth, (user) => {
    if (user) {
        myUID = user.uid;
        loginScreen.style.display = 'none';
        appScreen.style.display = 'flex';

        // Load Profil Sendiri
        onValue(ref(db, 'users/' + myUID), (snap) => {
            const d = snap.val();
            if (d) {
                updateMyProfileUI(d.name, d.bio, d.avatar);
                // Isi form edit profil
                document.getElementById('edit-name').value = d.name;
                document.getElementById('edit-bio').value = d.bio;
                document.getElementById('preview-avatar').src = d.avatar;
            } else {
                saveMyProfile(user.displayName, "Available", user.photoURL);
            }
        });
        document.getElementById('my-uid-text').innerText = myUID.substring(0, 8);

        // Load Preferences (Pin & Nickname)
        onValue(ref(db, `users/${myUID}/preferences`), (snap) => {
            globalPreferences = snap.val() || {};
            // Refresh tampilan kontak jika ada perubahan preferensi
            Object.keys(globalPreferences).forEach(uid => updateContactDisplay(uid));
        });

        loadContactList();
    }
});

function updateMyProfileUI(name, bio, avatar) {
    document.getElementById('my-display-name').innerText = name;
    document.getElementById('my-bio-text').innerText = bio;
    document.getElementById('my-avatar-img').src = avatar;
}

function saveMyProfile(name, bio, avatar) {
    set(ref(db, 'users/' + myUID), { name, bio, avatar });
}

// =======================================================
// 5. MANAJEMEN KONTAK (SORTING & PINNING)
// =======================================================
// ==========================================
// UPDATE: LOAD CONTACT (DENGAN AUTO DELETE)
// ==========================================
function loadContactList() {
    const chatsRef = ref(db, 'chats');

    // 1. Listen Chat Baru (Logic Lama)
    onChildAdded(chatsRef, (snap) => {
        if (snap.key.includes(myUID)) {
            let friendID = snap.key.replace(myUID, '').replace('_', '');
            createContactElement(friendID);
            monitorChatMetadata(snap.key, friendID);
        }
    });

    // 2. Listen Chat Dihapus (LOGIC BARU "TELEGRAM STYLE")
    // Jika chat dihapus dari DB, hapus juga dari sidebar
    onChildRemoved(chatsRef, (snap) => {
        if (snap.key.includes(myUID)) {
            let friendID = snap.key.replace(myUID, '').replace('_', '');

            // Hapus elemen kontak dari sidebar
            const el = document.getElementById('contact-' + friendID);
            if (el) {
                el.remove();
            }

            // Jika kita sedang membuka chat tersebut, tutup paksa
            if (activeFriendUID === friendID) {
                alert("Chat ini telah dihapus oleh salah satu pihak.");
                closeCurrentChat(); // Kita buat fungsi ini nanti
            }
        }
    });
}

// =================================================================
// 1. GANTI FUNGSI createContactElement (HAPUS YANG LAMA, PASTE INI)
// =================================================================
function createContactElement(uid) {
    // Cek duplikat biar gak error
    if (document.getElementById('contact-' + uid)) return;

    const list = document.getElementById('contact-list');
    const div = document.createElement('div');
    div.className = 'contact-item';
    div.id = 'contact-' + uid;

    // Default sorting data
    div.dataset.timestamp = 0;
    div.dataset.pinned = "false";

    // HTML Structure (Lengkap dengan ID unik untuk setiap tombol)
    div.innerHTML = `
        <img id="img-${uid}" class="contact-avatar-list" src="https://via.placeholder.com/50">
        <div class="contact-info-list">
            <div class="contact-name-row">
                <div style="display:flex; align-items:center;">
                    <span id="name-${uid}" class="contact-name-list">Memuat...</span>
                    <span id="pin-${uid}" class="pin-icon">📌</span>
                </div>
                <div id="time-${uid}" style="font-size:11px; color:var(--text-secondary);"></div>
            </div>
            <div style="display:flex; justify-content:space-between;">
                <small id="prev-${uid}" style="color:var(--text-secondary);">...</small>
                <div id="badge-${uid}" class="unread-badge">0</div>
            </div>
        </div>
        
        <button class="contact-menu-btn" id="btn-menu-${uid}">⋮</button>
        
        <div id="menu-${uid}" class="contact-menu-popup">
            <div class="contact-menu-item" id="act-pin-${uid}">📌 Sematkan/Lepas</div>
            <div class="contact-menu-item" id="act-rename-${uid}">✏️ Ubah Nama</div>
            <div class="contact-menu-item" id="act-delete-${uid}" style="color:#d32f2f;">🗑️ Hapus Chat</div>
        </div>
    `;

    // --- EVENT LISTENERS (LOGIKA KLIK) ---

    // A. Klik Kontak (Buka Chat) - Kecuali klik menu
    div.addEventListener('click', (e) => {
        if (!e.target.closest('.contact-menu-btn') && !e.target.closest('.contact-menu-popup')) {
            openChat(uid);
        }
    });

    // B. Klik Titik Tiga (Buka Menu)
    const btnMenu = div.querySelector(`#btn-menu-${uid}`);
    if (btnMenu) {
        btnMenu.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop biar ga buka chat
            toggleContactMenu(uid);
        });
    }

    // C. Klik Aksi: PIN
    const btnPin = div.querySelector(`#act-pin-${uid}`);
    if (btnPin) {
        btnPin.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(uid);
            closeContactMenu();
        });
    }

    // D. Klik Aksi: RENAME
    const btnRename = div.querySelector(`#act-rename-${uid}`);
    if (btnRename) {
        btnRename.addEventListener('click', (e) => {
            e.stopPropagation();
            renameContact(uid);
            closeContactMenu();
        });
    }

    // E. Klik Aksi: DELETE
    const btnDelete = div.querySelector(`#act-delete-${uid}`);
    if (btnDelete) {
        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChatForEveryone(uid);
            closeContactMenu();
        });
    }

    // Masukkan ke List HTML
    list.appendChild(div);

    // Load Data Profil Teman
    onValue(ref(db, 'users/' + uid), (snap) => {
        const d = snap.val() || { name: 'User', avatar: 'https://via.placeholder.com/50' };
        globalUsersData[uid] = d;
        document.getElementById('img-' + uid).src = d.avatar;
        updateContactDisplay(uid);
    });
}

// =================================================================
// 2. FUNGSI HELPER (PASTE INI DI BAWAHNYA, HAPUS YANG LAMA)
// =================================================================

// function toggleContactMenu(uid) {
//     document.querySelectorAll('.contact-menu-popup').forEach(el => el.style.display = 'none');
//     const menu = document.getElementById('menu-' + uid);
//     if (menu) menu.style.display = 'flex';
//     const overlay = document.getElementById('contact-menu-overlay');
//     if (overlay) overlay.style.display = 'block';
// }

// function closeContactMenu() {
//     document.querySelectorAll('.contact-menu-popup').forEach(el => el.style.display = 'none');
//     const overlay = document.getElementById('contact-menu-overlay');
//     if (overlay) overlay.style.display = 'none';
// }
// // Event klik overlay buat tutup menu
// const overlayMenu = document.getElementById('contact-menu-overlay');
// if (overlayMenu) overlayMenu.onclick = closeContactMenu;


// function togglePin(uid) {
//     const currentStatus = globalPreferences[uid]?.isPinned || false;
//     update(ref(db, `users/${myUID}/preferences/${uid}`), { isPinned: !currentStatus });
// }

// function renameContact(uid) {
//     const oldName = globalPreferences[uid]?.nickname || globalUsersData[uid]?.name;
//     const newName = prompt("Ubah Nama Teman:", oldName);
//     if (newName !== null) {
//         update(ref(db, `users/${myUID}/preferences/${uid}`), { nickname: newName });
//     }
// }

// ==========================================
// UPDATE: HAPUS CHAT 1 ARAH (SAYA SAJA)
// ==========================================
function deleteChatForMe(partnerID) {
    const yakin = confirm("Hapus chat ini dari tampilan Anda? (History tidak hilang di lawan bicara)");
    if (yakin) {
        const roomID = [myUID, partnerID].sort().join('_');
        
        // 1. Beri tanda 'hidden' khusus untuk saya (hidden_UID_SAYA = true)
        let updateData = {};
        updateData[`hidden_${myUID}`] = true;
        
        update(ref(db, `chats/${roomID}`), updateData)
            .then(() => {
                // 2. Hapus dari layar HP/Laptop secara manual biar cepat
                const el = document.getElementById('contact-' + partnerID);
                if(el) el.remove();
                
                // 3. Tutup chat jika sedang dibuka
                if (activeFriendUID === partnerID) closeCurrentChat();
                
                alert("Chat berhasil disembunyikan.");
            })
            .catch(err => alert("Gagal: " + err.message));
    }
}

function monitorChatMetadata(roomID, friendID) {
    const chatRef = ref(db, `chats/${roomID}/messages`);

    // Gunakan 'limitToLast' agar lebih hemat performa, tapi 'onValue' 
    // akan tetap mengambil seluruh jika struktur DB sederhana. 
    // Untuk sorting akurat, kita perlu timestamp terakhir.
    onValue(chatRef, (snap) => {
        let lastTime = 0;
        let lastMsg = "Belum ada pesan";
        let unread = 0;

        snap.forEach(child => {
            const m = child.val();
            if (m.timestamp > lastTime) lastTime = m.timestamp;

            // Text Preview
            if (m.type === 'text') lastMsg = m.text;
            else if (m.type === 'image') lastMsg = "📷 Foto";
            else if (m.type === 'video') lastMsg = "🎥 Video";
            else if (m.type === 'audio') lastMsg = "🎤 Voice Note";
            else if (m.type === 'file') lastMsg = "📄 File";

            // Unread Count
            if (m.sender !== myUID && !m.read) unread++;
        });

        // Update DOM
        const contactDiv = document.getElementById('contact-' + friendID);
        if (contactDiv) {
            contactDiv.dataset.timestamp = lastTime;
            document.getElementById('time-' + friendID).innerText = lastTime ? new Date(lastTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            document.getElementById('prev-' + friendID).innerText = lastMsg.substring(0, 25);

            const badge = document.getElementById('badge-' + friendID);
            badge.innerText = unread;
            badge.style.display = unread > 0 ? 'block' : 'none';

            // AUTO SORT
            reorderList();
        }
    });
}

// =======================================================
// 6. CHAT ENGINE
// =======================================================
window.openChat = async (uid) => {
    activeFriendUID = uid;
    currentRoomID = [myUID, uid].sort().join('_');

    // UI Update
    document.body.classList.add('mobile-chat-active');
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('chat-header').style.visibility = 'visible';
    document.getElementById('chat-footer-wrapper').style.visibility = 'visible';

    // Header Info
    const pref = globalPreferences[uid] || {};
    document.getElementById('friend-name-text').innerText = pref.nickname || globalUsersData[uid]?.name || "User";
    document.getElementById('friend-avatar-img').src = globalUsersData[uid]?.avatar || "";

    const box = document.getElementById('messages-box');
    box.innerHTML = '';

    // Mark as Read
    const messagesRef = ref(db, `chats/${currentRoomID}/messages`);
    get(messagesRef).then(snap => {
        snap.forEach(c => {
            if (c.val().sender === uid && !c.val().read) {
                update(ref(db, `chats/${currentRoomID}/messages/${c.key}`), { read: true });
            }
        });
    });

    // Listen Messages
    onChildAdded(messagesRef, (snap) => {
        renderBubble(snap.key, snap.val());
        box.scrollTop = box.scrollHeight;

        // Mark read realtime
        if (snap.val().sender === uid && !snap.val().read) {
            update(ref(db, `chats/${currentRoomID}/messages/${snap.key}`), { read: true });
        }
    });

    onChildChanged(messagesRef, (snap) => {
        const val = snap.val();
        // Update teks edit
        const textEl = document.querySelector(`#msg-${snap.key} .bubble-text`);
        if (textEl && val.type === 'text') {
            textEl.innerHTML = val.text + (val.isEdited ? ' <i style="font-size:11px;color:#888">(diedit)</i>' : '');
        }
    });

    onChildRemoved(messagesRef, (snap) => {
        const el = document.getElementById(`msg-${snap.key}`);
        if (el) el.remove();
    });

    monitorTyping(currentRoomID, uid);
};

// ... di dalam logic.js ...

function renderBubble(key, data) {
    const isMe = data.sender === myUID;
    const isSystem = data.sender === 'system';

    const div = document.createElement('div');
    div.className = isSystem ? 'bubble system' : `bubble ${isMe ? 'me' : 'them'}`;
    div.id = `msg-${key}`;

    // --- PERUBAHAN DISINI ---
    // Hapus div.onclick yang lama.
    // Ganti dengan Gesture Handler (hanya jika bukan pesan system)
    if (!isSystem) {
        attachGestures(div, key, data, isMe);
    }
    // ------------------------

    // ... (Sisa kode renderBubble ke bawah SAMA PERSIS seperti sebelumnya) ...
    // ... Render Content, HTML, Time, Append Child, dll ...

    let contentHTML = '';
    // (Copy sisa kode renderBubble kamu yang lama di sini...)
    if (data.type === 'image') contentHTML = `<img src="${data.content}" class="media-img" onclick="window.open(this.src)">`;
    else if (data.type === 'video') contentHTML = `<video src="${data.content}" controls class="media-img"></video>`;
    else if (data.type === 'audio') contentHTML = `<audio src="${data.content}" controls style="width:200px; margin-bottom:5px;"></audio>`;
    else if (data.type === 'file') contentHTML = `<a href="${data.content}" download="${data.text}" class="media-link">📄 ${data.text}</a>`;
    else contentHTML = `<span class="bubble-text">${data.text}</span>` + (data.isEdited ? ' <i style="font-size:11px;color:#888">(diedit)</i>' : '');

    let replyHTML = '';
    if (data.replyTo && !isSystem) {
        replyHTML = `
            <div style="background:rgba(0,0,0,0.1); border-left:4px solid #00a884; padding:5px; margin-bottom:5px; font-size:12px; border-radius:4px;">
                <div style="color:#00a884; font-weight:bold;">${data.replyTo.senderName}</div>
                <div>${data.replyTo.text.substring(0, 30)}...</div>
            </div>
        `;
    }

    const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tickHTML = (isMe && !isSystem) ? `<span class="tick ${data.read ? 'read' : ''}">✓✓</span>` : '';

    if (isSystem) {
        div.innerHTML = `<span class="system-text">${data.text}</span>`;
    } else {
        div.innerHTML = `
            ${replyHTML}
            ${contentHTML}
            <div class="bubble-time">
                ${timeStr} ${tickHTML}
            </div>
        `;
    }

    document.getElementById('messages-box').appendChild(div);
}

// =======================================================
// 7. INPUT & MEDIA & SENDING
// =======================================================
// ==========================================
// UPDATE FUNGSI KIRIM PESAN (AUTO CLOSE EMOJI)
// ==========================================
window.kirimPesan = () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();

    // Jangan kirim kalau kosong
    if (!text) return;

    // 1. Logika Kirim (Edit atau Baru)
    if (isEditing && selectedMsgID) {
        // Mode Edit Pesan
        update(ref(db, `chats/${currentRoomID}/messages/${selectedMsgID}`), {
            text: text,
            isEdited: true
        });
    } else {
        // Mode Pesan Baru
        const payload = {
            sender: myUID,
            type: 'text',
            text: text,
            timestamp: serverTimestamp(),
            read: false
        };
        // Cek apakah sedang me-reply
        if (isReplying && replyData) payload.replyTo = replyData;

        // Push ke Firebase
        push(ref(db, `chats/${currentRoomID}/messages`), payload);
    }

    // 2. Reset Input & Reply
    input.value = '';
    cancelReply(); // Ini juga menutup preview reply

    // --- 3. TAMBAHAN BARU: TUTUP POPUP EMOJI & ATTACH ---
    const emojiPicker = document.getElementById('emoji-picker-container');
    const attachMenu = document.getElementById('attach-menu');

    if (emojiPicker) emojiPicker.classList.add('hidden'); // Tutup Emoji
    if (attachMenu) attachMenu.classList.add('hidden');   // Tutup Menu Lampiran (sekalian biar rapi)

    // Kembalikan tombol Mic (karena input sudah kosong)
    document.getElementById('btn-mic').classList.remove('hidden');
    document.getElementById('btn-send').classList.add('hidden');
};

// Handle File (Image/Video)
// ==========================================
// FITUR LAMPIRAN (ATTACHMENT MENU)
// ==========================================

const btnAttach = document.getElementById('btn-toggle-attach');
const attachMenu = document.getElementById('attach-menu');
const triggerDoc = document.getElementById('trigger-doc');
const triggerCam = document.getElementById('trigger-cam');

// 1. Toggle Menu (Buka/Tutup saat klik tombol +)
if (btnAttach) {
    btnAttach.addEventListener('click', (e) => {
        e.stopPropagation();
        // Tutup emoji picker kalau lagi kebuka biar gak numpuk
        document.getElementById('emoji-picker-container').classList.add('hidden');

        // Toggle menu attach
        attachMenu.classList.toggle('hidden');
    });
}

// 2. Klik Pilihan "Dokumen" -> Buka File Input Doc
if (triggerDoc) {
    triggerDoc.addEventListener('click', () => {
        document.getElementById('file-input-doc').click();
        attachMenu.classList.add('hidden'); // Tutup menu setelah klik
    });
}

// 3. Klik Pilihan "Galeri/Kamera" -> Buka File Input Media
if (triggerCam) {
    triggerCam.addEventListener('click', () => {
        document.getElementById('file-input-media').click();
        attachMenu.classList.add('hidden'); // Tutup menu setelah klik
    });
}

// 4. Tutup menu jika klik di luar area
document.addEventListener('click', (e) => {
    if (!attachMenu.contains(e.target) && e.target !== btnAttach) {
        attachMenu.classList.add('hidden');
    }
});

// =======================================================
// 8. INTERAKSI UI & HELPERS
// =======================================================

// Input Handler (Enter & Typing)
document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') window.kirimPesan();
});

// --- PERBAIKAN TOMBOL KIRIM MOBILE ---
const btnSend = document.getElementById('btn-send');
if (btnSend) {
    // Event Klik (Untuk Desktop & Mobile)
    btnSend.addEventListener('click', (e) => {
        e.preventDefault(); // Mencegah perilaku aneh di mobile
        window.kirimPesan();
    });

    // Opsional: Event Touch (Agar lebih responsif di HP kentang)
    btnSend.addEventListener('touchstart', (e) => {
        e.preventDefault();
        window.kirimPesan();
    });
}

document.getElementById('msg-input').addEventListener('input', (e) => {
    const val = e.target.value;
    // Toggle Mic/Send Button
    document.getElementById('btn-mic').classList.toggle('hidden', val.length > 0);
    document.getElementById('btn-send').classList.toggle('hidden', val.length === 0);

    // Typing Status
    if (currentRoomID) {
        update(ref(db, `chats/${currentRoomID}/typing/${myUID}`), { isTyping: true });
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            update(ref(db, `chats/${currentRoomID}/typing/${myUID}`), { isTyping: false });
        }, 2000);
    }
});

function monitorTyping(roomID, uid) {
    onValue(ref(db, `chats/${roomID}/typing/${uid}/isTyping`), (snap) => {
        const el = document.getElementById('friend-bio-text');
        if (snap.val()) {
            el.innerText = "sedang mengetik...";
            el.classList.add('typing-text');
        } else {
            el.innerText = globalUsersData[uid]?.bio || "Online";
            el.classList.remove('typing-text');
        }
    });
}

// Message Options (Reply, Edit, Delete)
function showMessageOptions(key, data, isMe) {
    selectedMsgID = key;
    selectedMsgData = data;
    openModal('msg-option-menu');
    document.getElementById('msg-overlay').style.display = 'block';

    const btnEdit = document.getElementById('opt-edit');
    const btnDel = document.getElementById('opt-delete');

    if (isMe) {
        btnDel.style.display = 'block';
        // Edit cuma boleh < 1 jam dan text only
        const isFresh = (Date.now() - data.timestamp) < 3600000;
        btnEdit.style.display = (data.type === 'text' && isFresh) ? 'block' : 'none';
    } else {
        btnDel.style.display = 'none';
        btnEdit.style.display = 'none';
    }
}

document.getElementById('msg-overlay').onclick = () => {
    document.getElementById('msg-option-menu').style.display = 'none';
    document.getElementById('msg-overlay').style.display = 'none';
};

document.getElementById('opt-reply').onclick = () => {
    document.getElementById('msg-option-menu').style.display = 'none';
    document.getElementById('msg-overlay').style.display = 'none';
    isReplying = true;
    isEditing = false;

    const pref = globalPreferences[selectedMsgData.sender] || {};
    const name = (selectedMsgData.sender === myUID) ? "Anda" : (pref.nickname || globalUsersData[selectedMsgData.sender]?.name);

    replyData = {
        text: selectedMsgData.text || "[Media]",
        senderName: name
    };

    document.getElementById('reply-preview').style.display = 'flex';
    document.getElementById('reply-to-name').innerText = name;
    document.getElementById('reply-to-text').innerText = replyData.text;
    document.getElementById('msg-input').focus();
};

document.getElementById('opt-edit').onclick = () => {
    document.getElementById('msg-option-menu').style.display = 'none';
    document.getElementById('msg-overlay').style.display = 'none';
    isEditing = true;
    isReplying = false;

    document.getElementById('msg-input').value = selectedMsgData.text;
    document.getElementById('msg-input').focus();

    document.getElementById('reply-preview').style.display = 'flex';
    document.getElementById('reply-to-name').innerText = "Mode Edit";
    document.getElementById('reply-to-text').innerText = "Mengedit pesan...";
};

document.getElementById('opt-delete').onclick = () => {
    document.getElementById('msg-option-menu').style.display = 'none';
    document.getElementById('msg-overlay').style.display = 'none';
    if (confirm("Hapus pesan ini untuk semua orang?")) {
        remove(ref(db, `chats/${currentRoomID}/messages/${selectedMsgID}`));
    }
};

window.cancelReply = () => {
    isReplying = false;
    isEditing = false;
    replyData = null;
    document.getElementById('reply-preview').style.display = 'none';
    document.getElementById('msg-input').value = '';
};
document.getElementById('btn-cancel-reply').onclick = window.cancelReply;

// Contact Menu Helper
// function toggleContactMenu(uid) {
//     document.querySelectorAll('.contact-menu-popup').forEach(el => el.style.display = 'none');
//     document.getElementById('menu-' + uid).style.display = 'flex';
//     document.getElementById('contact-menu-overlay').style.display = 'block';
// }

// function closeContactMenu() {
//     document.querySelectorAll('.contact-menu-popup').forEach(el => el.style.display = 'none');
//     document.getElementById('contact-menu-overlay').style.display = 'none';
// }
// document.getElementById('contact-menu-overlay').onclick = closeContactMenu;

// function togglePin(uid) {
//     const currentStatus = globalPreferences[uid]?.isPinned || false;
//     update(ref(db, `users/${myUID}/preferences/${uid}`), { isPinned: !currentStatus });
// }

// function renameContact(uid) {
//     const oldName = globalPreferences[uid]?.nickname || globalUsersData[uid]?.name;
//     const newName = prompt("Ubah Nama Teman:", oldName);
//     if (newName !== null) {
//         update(ref(db, `users/${myUID}/preferences/${uid}`), { nickname: newName });
//     }
// }

// Search Chat
// document.getElementById('btn-search-chat').onclick = async () => {
//     const uid = document.getElementById('new-friend-uid').value.trim();
//     if (!uid) return;
//     if (uid === myUID) return alert("Itu UID kamu sendiri.");

//     const s = await get(ref(db, 'users/' + uid));
//     if (s.exists()) {
//         createContactElement(uid);
//         openChat(uid);
//         document.getElementById('new-friend-uid').value = '';
//     } else {
//         alert("UID tidak ditemukan.");
//     }
// };

// Modal Helpers
window.openModal = (id) => document.getElementById(id).style.display = 'flex';
window.closeModal = (id) => document.getElementById(id).style.display = 'none';

// Profile Modal
document.getElementById('btn-my-profile').onclick = () => openModal('profile-modal');
document.getElementById('btn-cancel-profile').onclick = () => closeModal('profile-modal');
document.getElementById('btn-save-profile').onclick = () => {
    saveMyProfile(
        document.getElementById('edit-name').value,
        document.getElementById('edit-bio').value,
        document.getElementById('preview-avatar').src
    );
    closeModal('profile-modal');
};
document.getElementById('file-input-avatar').onchange = (e) => {
    const f = e.target.files[0];
    if (f) {
        const r = new FileReader();
        r.onload = (ev) => document.getElementById('preview-avatar').src = ev.target.result;
        r.readAsDataURL(f);
    }
};

// Expiry Modal
document.getElementById('btn-expiry-timer').onclick = () => openModal('expiry-modal');
document.getElementById('btn-close-expiry').onclick = () => closeModal('expiry-modal');
document.querySelectorAll('.expiry-item').forEach(item => {
    item.onclick = () => {
        const h = parseInt(item.dataset.val);

        // 1. Tentukan Teks Tampilan
        let displayText = "";
        if (h === 0) displayText = "Mati";
        else if (h === 24) displayText = "24 Jam";
        else if (h === 168) displayText = "7 Hari";
        else if (h === 720) displayText = "30 Hari";
        else displayText = h + " Jam"; // Default

        // 2. Simpan & Kirim Pesan System
        if (currentRoomID) {
            // Update setting di database
            set(ref(db, `chats/${currentRoomID}/settings/expiryHours`), h);

            // Kirim pesan notifikasi kuning
            push(ref(db, `chats/${currentRoomID}/messages`), {
                sender: 'system',
                text: `Pesan sementara diset: ${displayText}`, // <--- Pakai teks yang sudah diubah
                timestamp: serverTimestamp(),
                read: true
            });
        }

        // Tutup Modal
        closeModal('expiry-modal');
    };
});

// UI Helpers
document.getElementById('btn-theme').onclick = () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
};
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');

document.getElementById('btn-back-mobile').onclick = () => document.body.classList.remove('mobile-chat-active');
document.getElementById('btn-copy-uid').onclick = () => {
    navigator.clipboard.writeText(myUID).then(() => alert("UID Tersalin!"));
};

// PWA Install
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('btn-install-login').style.display = 'block';
});
document.getElementById('btn-install-login').onclick = async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
    }
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// ==========================================
// FITUR EMOJI & HISTORY
// ==========================================

// 1. Daftar Emoji Umum (Bisa ditambah manual)
const commonEmojis = [
    "😀", "😂", "🤣", "😊", "😍", "😘", "🤪", "😎", "😭", "😡", "👍", "👎", "🙏", "❤️", "💔", "🔥", "✨", "🎉",
    "👋", "👌", "💪", "👀", "🧠", "💀", "👻", "👽", "🤖", "💩", "✅", "❌", "💯", "💢", "💥", "💦", "💨",
    "🙈", "🙉", "🙊", "🐵", "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷",
    "🐸", "🐔", "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌",
    "🍎", "🍌", "🍉", "🍇", "🍓", "🍒", "🍑", "🍍", "🥭", "🥥", "🥝", "🍅", "🥑", "🍆", "🥔", "🥕", "🌽",
    "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "rugby", "🎱", "🏓", "🏸", "🥅", "🏒", "🏑", "🏏", "⛳", "🏹",
    "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🚚", "🚛", "🚜", "🏍️", "🛵", "🚲", "🛴"
];

// 2. Load History dari LocalStorage
let recentEmojis = JSON.parse(localStorage.getItem('wa_recent_emojis')) || ["😀", "👍", "❤️"];

// 3. Render Emoji Picker
function renderEmojiPicker() {
    const recentGrid = document.getElementById('emoji-recent');
    const allGrid = document.getElementById('emoji-list');

    // Render Recent
    recentGrid.innerHTML = '';
    recentEmojis.forEach(char => {
        const span = document.createElement('span');
        span.className = 'emoji-item';
        span.innerText = char;
        span.onclick = () => addEmojiToInput(char);
        recentGrid.appendChild(span);
    });

    // Render All (Cuma sekali biar ringan)
    if (allGrid.children.length === 0) {
        commonEmojis.forEach(char => {
            const span = document.createElement('span');
            span.className = 'emoji-item';
            span.innerText = char;
            span.onclick = () => addEmojiToInput(char);
            allGrid.appendChild(span);
        });
    }
}

// 4. Masukkan Emoji ke Input & Update History
function addEmojiToInput(char) {
    const input = document.getElementById('msg-input');

    // Tambah di posisi kursor (atau di akhir)
    input.value += char;

    // Trigger event input agar tombol Mic berubah jadi Send
    input.dispatchEvent(new Event('input'));
    input.focus();

    // Update History (Taruh di paling depan)
    // Hapus jika sudah ada sebelumnya (biar ga duplikat)
    recentEmojis = recentEmojis.filter(e => e !== char);
    // Masukkan ke index 0
    recentEmojis.unshift(char);
    // Batasi cuma 16 history terakhir
    if (recentEmojis.length > 16) recentEmojis.pop();

    // Simpan ke Browser
    localStorage.setItem('wa_recent_emojis', JSON.stringify(recentEmojis));

    // Render ulang bagian Recent
    renderEmojiPicker();
}

// 5. Tombol Buka/Tutup Picker
const btnEmoji = document.getElementById('btn-toggle-emoji');
const emojiContainer = document.getElementById('emoji-picker-container');

if (btnEmoji) {
    btnEmoji.onclick = (e) => {
        e.stopPropagation(); // Biar ga langsung ketutup
        const isHidden = emojiContainer.classList.contains('hidden');
        if (isHidden) {
            emojiContainer.classList.remove('hidden');
            renderEmojiPicker(); // Render saat dibuka
        } else {
            emojiContainer.classList.add('hidden');
        }
    };
}

// Tutup picker kalau klik di luar area
document.addEventListener('click', (e) => {
    if (!emojiContainer.contains(e.target) && e.target !== btnEmoji) {
        emojiContainer.classList.add('hidden');
    }
});

// ==========================================
// LOGIC GESTURE (SWIPE REPLY & LONG PRESS)
// ==========================================

function attachGestures(element, key, data, isMe) {
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    let longPressTimer;

    // --- 1. LONG PRESS (TAHAN LAMA) ---
    const startPress = () => {
        longPressTimer = setTimeout(() => {
            // Efek Getar (Haptic)
            if (navigator.vibrate) navigator.vibrate(50);

            // Buka Menu Opsi (Edit/Hapus)
            showMessageOptions(key, data, isMe);
        }, 600); // Tahan selama 600ms
    };

    const cancelPress = () => clearTimeout(longPressTimer);

    // --- 2. TOUCH EVENTS (HP) ---
    element.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        element.style.transition = 'none'; // Matikan animasi saat sedang digeser
        startPress(); // Mulai timer tahan lama
    }, { passive: true });

    element.addEventListener('touchmove', (e) => {
        const diffX = e.touches[0].clientX - touchStartX;
        const diffY = e.touches[0].clientY - touchStartY;

        // Jika user scroll ke atas/bawah (Vertikal), batalkan semua gesture chat
        if (Math.abs(diffY) > Math.abs(diffX)) {
            cancelPress();
            return;
        }

        // Jika user mulai geser ke kanan (Horizontal)
        if (diffX > 10) {
            cancelPress(); // Batalkan timer long press
            isSwiping = true;

            // Efek geser bubble mengikuti jari (Max 80px)
            const move = Math.min(diffX, 80);
            element.style.transform = `translateX(${move}px)`;
        }
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
        cancelPress();
        element.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'; // Hidupkan animasi balik
        element.style.transform = 'translateX(0)'; // Kembalikan ke posisi 0

        // Cek apakah swipe cukup jauh untuk trigger Reply?
        if (isSwiping) {
            const diffX = e.changedTouches[0].clientX - touchStartX;
            if (diffX > 50) { // Threshold 50px
                prepareReply(data); // Trigger Reply
            }
        }
        isSwiping = false;
    });

    // --- 3. MOUSE EVENTS (PC) ---
    // Di PC, Long Press = Klik Tahan (MouseDown)
    element.addEventListener('mousedown', startPress);
    element.addEventListener('mouseup', cancelPress);
    element.addEventListener('mouseleave', cancelPress);

    // Cegah menu klik kanan bawaan browser (biar ga ganggu)
    element.addEventListener('contextmenu', e => e.preventDefault());
}

// Fungsi Helper: Siapkan Reply (Dipakai oleh Swipe & Menu)
function prepareReply(data) {
    const pref = globalPreferences[data.sender] || {};
    const name = (data.sender === myUID) ? "Anda" : (pref.nickname || globalUsersData[data.sender]?.name || "User");

    isReplying = true;
    isEditing = false;
    replyData = {
        text: data.text || "[Media]",
        senderName: name
    };

    document.getElementById('reply-preview').style.display = 'flex';
    document.getElementById('reply-to-name').innerText = name;
    document.getElementById('reply-to-text').innerText = replyData.text;
    document.getElementById('msg-input').focus();

    // Getar dikit tanda sukses reply
    if (navigator.vibrate) navigator.vibrate(30);
}

// ==========================================
// LOGIKA ANONYMOUS CHAT (MATCHMAKING)
// ==========================================

let isAnonMode = false;
let anonSearchListener = null;
let anonRoomListener = null;

// UI Elements
const btnAnonFab = document.getElementById('btn-anon-fab');
const anonPopup = document.getElementById('anon-popup');
const btnAnonStart = document.getElementById('btn-anon-start');
const btnAnonCancel = document.getElementById('btn-anon-cancel');
const btnAnonClose = document.getElementById('btn-anon-close');
const anonStatus = document.getElementById('anon-status');
const anonLoader = document.getElementById('anon-loader');
const btnAnonStop = document.getElementById('btn-anon-stop');

// 1. Toggle Popup
if (btnAnonFab) {
    btnAnonFab.onclick = () => anonPopup.classList.toggle('hidden');
}
if (btnAnonClose) {
    btnAnonClose.onclick = () => {
        stopSearching(); // Pastikan stop search kalau ditutup
        anonPopup.classList.add('hidden');
    };
}

// 2. Start Searching
if (btnAnonStart) {
    btnAnonStart.onclick = () => {
        // UI Update
        btnAnonStart.classList.add('hidden');
        btnAnonCancel.classList.remove('hidden');
        anonLoader.classList.remove('hidden');
        anonStatus.innerText = "Sedang mencari partner...";

        // Database Update: Set status 'searching'
        update(ref(db, `anonymous_queue/${myUID}`), {
            status: 'searching',
            timestamp: serverTimestamp()
        });

        // Mulai Matchmaking Listener
        startMatchmaking();
    };
}

// 3. Cancel Searching
if (btnAnonCancel) {
    btnAnonCancel.onclick = stopSearching;
}

function stopSearching() {
    // UI Reset
    btnAnonStart.classList.remove('hidden');
    btnAnonCancel.classList.add('hidden');
    anonLoader.classList.add('hidden');
    anonStatus.innerText = "Pencarian dibatalkan.";

    // Remove dari Queue
    remove(ref(db, `anonymous_queue/${myUID}`));

    // Matikan listener
    if (anonSearchListener) off(ref(db, 'anonymous_queue'), anonSearchListener);
}

// 4. Logika Inti Matchmaking
function startMatchmaking() {
    const queueRef = ref(db, 'anonymous_queue');

    // Dengerin perubahan di queue
    // (Dalam aplikasi real production, ini sebaiknya pakai Cloud Functions biar aman & cepat)
    // (Tapi untuk Client-Side Logic sederhana, ini works)

    onValue(queueRef, (snap) => {
        if (!snap.exists()) return;

        const users = snap.val();
        const myData = users[myUID];

        // Cek 1: Apakah kita sudah dipasangkan oleh orang lain?
        if (myData && myData.status === 'matched' && myData.partnerID) {
            enterAnonymousChat(myData.partnerID, myData.roomID);
            return;
        }

        // Cek 2: Jika belum, cari partner yang nganggur
        if (myData && myData.status === 'searching') {
            const potentialPartners = Object.keys(users).filter(uid =>
                uid !== myUID && users[uid].status === 'searching'
            );

            if (potentialPartners.length > 0) {
                // KETEMU! Ambil satu acak
                const partnerID = potentialPartners[0];
                const roomID = `anon_${myUID}_${partnerID}`;

                // Update status KITA jadi matched
                update(ref(db, `anonymous_queue/${myUID}`), {
                    status: 'matched', partnerID: partnerID, roomID: roomID
                });

                // Update status PARTNER jadi matched (Kita yang pasangkan)
                update(ref(db, `anonymous_queue/${partnerID}`), {
                    status: 'matched', partnerID: myUID, roomID: roomID
                });
            }
        }
    });
}

// 5. Masuk ke Room Anonymous
// ==========================================
/// ==========================================
// FIX: ENTER ANONYMOUS (BIAR PINDAH LAYAR DI HP)
// ==========================================
function enterAnonymousChat(partnerID, roomID) {
    // 1. Matikan listener search
    if (anonSearchListener) off(ref(db, 'anonymous_queue'), anonSearchListener);

    // 2. UI Updates
    anonPopup.classList.add('hidden');
    btnAnonStart.classList.remove('hidden');
    btnAnonCancel.classList.add('hidden');
    anonLoader.classList.add('hidden');

    isAnonMode = true;
    document.body.classList.add('anon-mode');

    // --- INI DIA BARIS SAKTI YANG KURANG KEMARIN! ---
    // Memaksa layar geser ke kanan (Chat Area) di tampilan Mobile
    document.body.classList.add('mobile-chat-active');
    // -----------------------------------------------

    activeFriendUID = partnerID;
    currentRoomID = roomID;

    // Header & Footer
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('chat-header').style.visibility = 'visible';
    document.getElementById('chat-footer-wrapper').style.visibility = 'visible';

    document.getElementById('friend-name-text').innerText = "🕵️ STRANGER";
    document.getElementById('friend-bio-text').innerText = "Anonymous Chat";
    document.getElementById('friend-avatar-img').src = "https://cdn-icons-png.flaticon.com/512/4645/4645949.png";

    // Tombol Stop
    btnAnonStop.classList.remove('hidden');
    document.getElementById('btn-expiry-timer').style.display = 'none';

    // Reset Chat Box
    const box = document.getElementById('messages-box');
    box.innerHTML = `<div style="text-align:center; padding:20px; color:#888; font-size:12px;">🔒 Anda terhubung dengan Stranger.<br>Identitas disembunyikan.</div>`;

    // Listen Chat
    const chatRef = ref(db, `anonymous_chats/${roomID}`);
    if (anonRoomListener) off(chatRef);
    anonRoomListener = onChildAdded(chatRef, (snap) => {
        const msg = snap.val();
        if (Date.now() - msg.timestamp > 3600000) return;
        renderBubble(snap.key, msg);
        box.scrollTop = box.scrollHeight;
    });

    // Monitor Partner Disconnect
    onValue(ref(db, `anonymous_queue/${partnerID}`), (snap) => {
        if (!snap.exists() && isAnonMode) {
            alert("Lawan bicara telah meninggalkan obrolan.");
            quitAnonymousChat();
        }
    });
}

// 6. Keluar dari Anonymous Chat
if (btnAnonStop) {
    btnAnonStop.onclick = () => {
        if (confirm("Yakin ingin mengakhiri sesi Anonymous?")) {
            quitAnonymousChat();
        }
    };
}

// ==========================================
// FIX: QUIT ANONYMOUS (BALIK KE LIST KONTAK)
// ==========================================
// ==========================================
// FIX FINAL: QUIT ANONYMOUS (BERSIH TOTAL)
// ==========================================
function quitAnonymousChat() {
    // 1. Matikan Mode Anonymous
    isAnonMode = false;
    document.body.classList.remove('anon-mode');
    document.body.classList.remove('mobile-chat-active'); // Balik ke layar utama

    // 2. Hapus Data Antrian (Biar ga dicari orang lagi)
    remove(ref(db, `anonymous_queue/${myUID}`));

    // 3. HAPUS DATA CHAT PERMANEN (Room Hancur)
    if (currentRoomID) {
        remove(ref(db, `anonymous_chats/${currentRoomID}`));
        // Jaga-jaga kalau ada yang nyasar ke folder 'chats' biasa
        remove(ref(db, `chats/${currentRoomID}`));
    }

    // 4. HAPUS "USER" GHOST DARI LIST KONTAK (Gambar Terlampir)
    if (activeFriendUID) {
        const ghostContact = document.getElementById('contact-' + activeFriendUID);
        if (ghostContact) {
            ghostContact.remove(); // Hapus elemen HTML
        }
    }

    // 5. Reset UI ke Tampilan Awal
    document.getElementById('chat-header').style.visibility = 'hidden';
    document.getElementById('chat-footer-wrapper').style.visibility = 'hidden';
    document.getElementById('welcome-screen').style.display = 'flex';

    btnAnonStop.classList.add('hidden');
    document.getElementById('btn-expiry-timer').style.display = 'block';

    // 6. Kosongkan Variabel
    currentRoomID = null;
    activeFriendUID = null;
}

// UPDATE FUNGSI KIRIM PESAN (Agar support path anonymous)
// Kita perlu modifikasi SEDIKIT fungsi kirimPesan yang lama agar
// dia tahu kalau lagi mode anon, kirimnya ke folder 'anonymous_chats'
const originalKirimPesan = window.kirimPesan; // Backup fungsi lama

window.kirimPesan = () => {
    if (isAnonMode) {
        // --- LOGIKA KIRIM PESAN KHUSUS ANONYMOUS ---
        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (!text) return;

        push(ref(db, `anonymous_chats/${currentRoomID}`), {
            sender: myUID,
            type: 'text',
            text: text,
            timestamp: serverTimestamp(),
            read: false
        });

        input.value = '';
        // Tutup emoji/attach jika ada
        const emojiPicker = document.getElementById('emoji-picker-container');
        if (emojiPicker) emojiPicker.classList.add('hidden');
        document.getElementById('btn-mic').classList.remove('hidden');
        document.getElementById('btn-send').classList.add('hidden');

    } else {
        // Panggil fungsi kirim pesan biasa
        originalKirimPesan();
    }
};

// ==========================================
// FITUR HAPUS CHAT 2 ARAH (TELEGRAM STYLE)
// ==========================================

window.deleteChatForEveryone = (partnerID) => {
    // Tampilkan konfirmasi seram biar user gak salah pencet
    const yakin = confirm(
        "PERINGATAN: Hapus Chat 2 Arah?\n\n" +
        "- Riwayat chat akan hilang PERMANEN.\n" +
        "- Chat akan hilang di HP Anda DAN HP Lawan.\n" +
        "- Kontak akan dihapus dari daftar.\n\n" +
        "Lanjutkan?"
    );

    if (yakin) {
        // Cari ID Room
        const roomID = [myUID, partnerID].sort().join('_');

        // HAPUS DARI FIREBASE (INI INTI "TELEGRAM STYLE"-NYA)
        // Karena kita menghapus Node utamanya, otomatis hilang buat semua orang.
        remove(ref(db, `chats/${roomID}`))
            .then(() => {
                console.log("Chat berhasil dimusnahkan.");
                // Tidak perlu update UI manual, karena 'onChildRemoved' di loadContactList akan bekerja
            })
            .catch((err) => {
                alert("Gagal menghapus: " + err.message);
            });
    }
};

// Fungsi Helper: Tutup Chat & Reset UI (Dipakai saat chat dihapus)
function closeCurrentChat() {
    document.getElementById('welcome-screen').style.display = 'flex';
    document.getElementById('chat-header').style.visibility = 'hidden';
    document.getElementById('chat-footer-wrapper').style.visibility = 'hidden';
    document.body.classList.remove('mobile-chat-active');

    currentRoomID = null;
    activeFriendUID = null;
}

// ==========================================
// FUNGSI UPDATE TAMPILAN KONTAK (YANG HILANG)
// ==========================================
function updateContactDisplay(uid) {
    const elName = document.getElementById('name-' + uid);
    const elPin = document.getElementById('pin-' + uid);
    const elDiv = document.getElementById('contact-' + uid);

    if (!elName || !elDiv) return;

    // 1. Tentukan Nama (Prioritas: Nickname -> Nama Asli -> "User")
    const pref = globalPreferences[uid] || {};
    const displayName = pref.nickname || globalUsersData[uid]?.name || "User";
    elName.innerText = displayName;

    // 2. Update Status Pin
    if (pref.isPinned) {
        elPin.style.display = 'inline-block';
        elDiv.dataset.pinned = "true";
    } else {
        elPin.style.display = 'none';
        elDiv.dataset.pinned = "false";
    }

    // 3. Sortir Ulang Daftar Kontak (Biar yang di-pin naik)
    reorderList();
}

// Fungsi Sortir (Helper untuk updateContactDisplay)
function reorderList() {
    const list = document.getElementById('contact-list');
    const items = Array.from(list.children);

    items.sort((a, b) => {
        const pinA = a.dataset.pinned === 'true';
        const pinB = b.dataset.pinned === 'true';
        const timeA = parseInt(a.dataset.timestamp || 0);
        const timeB = parseInt(b.dataset.timestamp || 0);

        // Prioritas 1: Pinned selalu di atas
        if (pinA && !pinB) return -1;
        if (!pinA && pinB) return 1;

        // Prioritas 2: Chat terbaru (Timestamp terbesar)
        return timeB - timeA;
    });

    items.forEach(item => list.appendChild(item));
}

// =======================================================
// FITUR SEARCH BAR (FILTER NAMA & ADD UID)
// =======================================================

const searchInput = document.getElementById('search-contact');
const btnAddUID = document.getElementById('btn-add-uid');

// 1. LOGIKA FILTER KONTAK (REALTIME SAAT MENGETIK)
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const keyword = e.target.value.toLowerCase();
        const items = document.querySelectorAll('.contact-item');

        items.forEach(item => {
            // Ambil UID dari ID elemen
            const uid = item.id.replace('contact-', '');
            
            // Ambil Nama yang tampil di layar
            const nameEl = document.getElementById('name-' + uid);
            const name = nameEl ? nameEl.innerText.toLowerCase() : "";

            // Cek apakah nama mengandung kata kunci?
            if (name.includes(keyword)) {
                item.style.display = 'flex'; // Tampilkan
            } else {
                item.style.display = 'none'; // Sembunyikan
            }
        });
    });
}

// 2. LOGIKA TAMBAH TEMAN VIA UID (TOMBOL +)
if (btnAddUID) {
    btnAddUID.onclick = async () => {
        const uid = searchInput.value.trim();
        
        // Validasi sederhana
        if (!uid) return alert("Masukkan UID teman yang ingin ditambahkan.");
        if (uid === myUID) return alert("Itu UID Anda sendiri.");

        // Cek apakah user ada di database?
        const s = await get(ref(db, 'users/' + uid));
        if (s.exists()) {
            // Kalau ada, langsung buat kontaknya & buka chat
            createContactElement(uid);
            openChat(uid);
            
            // Reset search bar
            searchInput.value = '';
            
            // Kembalikan semua kontak yang mungkin tersembunyi karena filter tadi
            document.querySelectorAll('.contact-item').forEach(el => el.style.display = 'flex');
        } else {
            alert("User dengan UID tersebut tidak ditemukan.");
        }
    };
}
