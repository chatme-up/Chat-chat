import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, collection, addDoc, query, orderBy, 
  onSnapshot, deleteDoc, doc, setDoc, getDoc 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBB_8Uq6pCSE8qqju6aknEt2V9uArkmBoc",
  authDomain: "encryptedchat-fbeea.firebaseapp.com",
  projectId: "encryptedchat-fbeea",
  storageBucket: "encryptedchat-fbeea.firebasestorage.app",
  messagingSenderId: "934746892023",
  appId: "1:934746892023:web:2b79852b718c438f3f15f2",
  measurementId: "G-QKY8HJVDTM"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getCryptoKey(passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("secure-chat-static-salt-v1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

async function encryptData(plaintext, passphrase) {
  try {
    const key = await getCryptoKey(passphrase);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)
    );
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${cipherHex}`;
  } catch (e) {
    return "";
  }
}

async function decryptData(payload, passphrase) {
  try {
    if (!payload || !payload.includes(":")) return "[Decryption Error]";
    const [ivHex, cipherHex] = payload.split(":");
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(cipherHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const key = await getCryptoKey(passphrase);
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return "[Encrypted Message / Wrong Key]";
  }
}

export default function ChatApp() {
  const [authMode, setAuthMode] = useState("login");
  const [isUnlocked, setIsUnlocked] = useState(false);
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [avatarImage, setAvatarImage] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  const [room, setRoom] = useState("global");
  const [passphrase, setPassphrase] = useState("my-secret-key");
  const [searchQuery, setSearchQuery] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [resetTargetUser, setResetTargetUser] = useState("");
  const [newPasswordForUser, setNewPasswordForUser] = useState("");
  const [adminSuccessMsg, setAdminSuccessMsg] = useState("");

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [lightboxImage, setLightboxImage] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "app_users"), (snapshot) => {
      const usersList = [];
      snapshot.forEach(doc => usersList.push(doc.data()));
      setAllUsers(usersList);
    });
    return () => unsubUsers();
  }, []);

  useEffect(() => {
    if (!isUnlocked) return;
    const q = query(collection(db, "rooms", room, "messages"), orderBy("timestamp", "asc"));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const loadedMsgs = [];
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const decryptedText = await decryptData(data.ciphertext, passphrase);
        loadedMsgs.push({ id: docSnap.id, ...data, decryptedText });
      }
      setMessages(loadedMsgs);
    });
    return () => unsubscribe();
  }, [isUnlocked, room, passphrase]);

  const handleAvatarFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setAvatarImage(reader.result);
    reader.readAsDataURL(file);
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    const cleanUser = username.trim().toLowerCase();
    if (!cleanUser || !password) return;

    const userRef = doc(db, "app_users", cleanUser);

    try {
      if (authMode === "signup") {
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setErrorMessage("⚠️ Username already exists. Please choose another or login.");
          return;
        }

        const passHash = await hashPassword(password);
        const isAdmin = allUsers.length === 0 || cleanUser === "admin";

        const newUserObj = {
          username: cleanUser,
          displayName: username.trim(),
          passwordHash: passHash,
          avatarImage: avatarImage || "https://api.dicebear.com/7.x/bottts/svg?seed=" + cleanUser,
          isAdmin,
          createdAt: Date.now()
        };

        await setDoc(userRef, newUserObj);
        setCurrentUser(newUserObj);
        setIsUnlocked(true);
      } else {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          setErrorMessage("⚠️ Username not found. Please sign up or contact Admin.");
          return;
        }

        const userData = userSnap.data();
        const inputHash = await hashPassword(password);

        if (userData.passwordHash !== inputHash) {
          setErrorMessage("❌ Incorrect password. Contact Admin to recover password.");
          return;
        }

        setCurrentUser(userData);
        setAvatarImage(userData.avatarImage);
        setIsUnlocked(true);
      }
    } catch (err) {
      setErrorMessage("Authentication error. Please try again.");
    }
  };

  const handleAdminPasswordReset = async (e) => {
    e.preventDefault();
    setAdminSuccessMsg("");
    if (!resetTargetUser || !newPasswordForUser) return;

    try {
      const targetRef = doc(db, "app_users", resetTargetUser.toLowerCase());
      const targetSnap = await getDoc(targetRef);

      if (!targetSnap.exists()) {
        alert("User not found.");
        return;
      }

      const newHash = await hashPassword(newPasswordForUser);
      await setDoc(targetRef, { passwordHash: newHash }, { merge: true });
      setAdminSuccessMsg(`Successfully reset password for @${resetTargetUser}!`);
      setResetTargetUser("");
      setNewPasswordForUser("");
    } catch (err) {
      alert("Failed to reset password.");
    }
  };

  const startDirectChatWithUser = (targetUser) => {
    const roomKey = [currentUser.username, targetUser.username].sort().join("_dm_");
    setRoom(roomKey);
    setSearchQuery("");
  };

  const sendMessage = async (type = "text", content = inputText) => {
    if (!content.trim() && type === "text") return;
    const ciphertext = await encryptData(content, passphrase);

    await addDoc(collection(db, "rooms", room, "messages"), {
      sender: currentUser.username,
      senderDisplayName: currentUser.displayName,
      type,
      ciphertext,
      timestamp: Date.now(),
      deletedFor: []
    });

    if (type === "text") setInputText("");
  };

  const deleteForEveryone = async (msgId) => {
    await deleteDoc(doc(db, "rooms", room, "messages", msgId));
  };

  const deleteForMe = (msgId) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        const hiddenList = m.deletedFor || [];
        return { ...m, deletedFor: [...hiddenList, currentUser.username] };
      }
      return m;
    }));
  };

  const startRecording = async () => {
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current.ondataavailable = (e) => e.data.size > 0 && audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = async () => {
        const audioBlobObj = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlobObj);
        reader.onloadend = async () => sendMessage("audio", reader.result);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone permission required.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => sendMessage("image", reader.result);
    reader.readAsDataURL(file);
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-200 via-slate-100 to-zinc-300 flex items-center justify-center p-4 font-sans text-slate-800">
        <div className="bg-white border border-slate-300 p-8 rounded-3xl shadow-xl w-full max-w-md">
          <div className="text-center mb-6">
            <div className="text-5xl mb-2">💬</div>
            <h1 className="text-2xl font-bold text-slate-800">Secure E2EE Chat</h1>
            <p className="text-slate-500 text-sm mt-1">Clean White & Grey Messaging</p>
          </div>

          <div className="flex bg-slate-100 p-1 rounded-xl mb-6 border border-slate-200">
            <button 
              onClick={() => { setAuthMode("login"); setErrorMessage(""); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${authMode === "login" ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Login
            </button>
            <button 
              onClick={() => { setAuthMode("signup"); setErrorMessage(""); }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${authMode === "signup" ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              Create Account
            </button>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs text-center font-medium">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-600 font-semibold mb-1">Username</label>
              <input 
                type="text" 
                value={username} 
                onChange={(e) => { setUsername(e.target.value); setErrorMessage(""); }} 
                placeholder="e.g. tijani" 
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-slate-500 transition"
                required 
              />
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-600 font-semibold mb-1">Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="Enter password..." 
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-slate-500 transition"
                required 
              />
            </div>
            
            {authMode === "signup" && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-600 font-semibold mb-1">Profile Photo</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-300 overflow-hidden flex items-center justify-center">
                    {avatarImage ? (
                      <img src={avatarImage} alt="Avatar preview" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl">📷</span>
                    )}
                  </div>
                  <label className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-xs font-semibold cursor-pointer text-slate-700 text-center transition">
                    Upload Photo
                    <input type="file" accept="image/*" onChange={handleAvatarFileSelect} className="hidden" />
                  </label>
                </div>
              </div>
            )}

            <button 
              type="submit" 
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-md transition transform active:scale-95 mt-2"
            >
              {authMode === "login" ? "Login" : "Sign Up & Enter"}
            </button>
          </form>

          {authMode === "login" && (
            <p className="text-[11px] text-slate-400 text-center mt-4">
              Forgot password? Contact your designated **Admin** to reset it.
            </p>
          )}
        </div>
      </div>
    );
  }

  const filteredUsers = allUsers.filter(u => 
    u.username !== currentUser.username && 
    (u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) || u.username.includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-screen bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex flex-col gap-3 shadow-sm z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img 
              src={currentUser.avatarImage} 
              alt="My avatar" 
              className="w-10 h-10 rounded-xl object-cover border border-slate-300" 
            />
            <div>
              <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
                {currentUser.displayName} 
                {currentUser.isAdmin && <span className="text-[10px] bg-slate-200 text-slate-800 px-2 py-0.5 rounded-full font-bold">ADMIN</span>}
              </h2>
              <p className="text-xs text-slate-500 font-mono">Chat Room: {room}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {currentUser.isAdmin && (
              <button 
                onClick={() => setShowAdminPanel(true)} 
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold shadow-sm transition"
              >
                ⚙️ Admin
              </button>
            )}
            <button 
              onClick={() => setIsUnlocked(false)} 
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium transition"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Global User Search Bar */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded-xl px-3 py-1.5">
            <span className="text-sm text-slate-400">🔍</span>
            <input 
              type="text" 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              placeholder="Search registered users by username..." 
              className="bg-transparent text-xs w-full focus:outline-none text-slate-900 placeholder-slate-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
            )}
          </div>

          {/* Search Dropdown Results */}
          {searchQuery && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <div className="p-3 text-xs text-slate-400 text-center">No registered users found</div>
              ) : (
                filteredUsers.map(u => (
                  <div 
                    key={u.username} 
                    onClick={() => startDirectChatWithUser(u)}
                    className="flex items-center justify-between p-2.5 hover:bg-slate-100 cursor-pointer border-b border-slate-100 last:border-none"
                  >
                    <div className="flex items-center gap-2">
                      <img src={u.avatarImage} alt="" className="w-7 h-7 rounded-lg object-cover" />
                      <div>
                        <p className="text-xs font-semibold text-slate-900">{u.displayName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">@{u.username}</p>
                      </div>
                    </div>
                    <span className="text-xs text-slate-700 font-medium">Message 💬</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </header>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-slate-100 via-zinc-100 to-slate-200">
        {messages.map((msg) => {
          const isMe = msg.sender === currentUser.username;

          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm relative group border ${isMe ? 'bg-slate-900 border-slate-900 text-white rounded-br-none' : 'bg-white border-slate-200 text-slate-800 rounded-bl-none'}`}>
                
                <div className={`flex items-center justify-between gap-4 mb-1 text-[11px] ${isMe ? 'text-slate-300' : 'text-slate-400'}`}>
                  <span className="font-semibold">@{msg.sender}</span>
                  <span className="font-mono">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                {msg.type === 'text' && (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.decryptedText}</p>
                )}
                {msg.type === 'image' && (
                  <img 
                    src={msg.decryptedText} 
                    alt="Shared media" 
                    onClick={() => setLightboxImage(msg.decryptedText)}
                    className="rounded-xl max-h-60 w-full object-cover cursor-pointer hover:opacity-95 transition mt-1 border border-slate-200" 
                  />
                )}
                {msg.type === 'audio' && (
                  <audio controls src={msg.decryptedText} className="mt-1 h-9 w-52 accent-slate-700"></audio>
                )}

                {/* Delete Menu */}
                <div className={`absolute top-2 ${isMe ? 'left-2' : 'right-2'} opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-slate-800 text-white backdrop-blur-md px-2 py-1 rounded-lg text-[10px]`}>
                  {isMe && (
                    <button onClick={() => deleteForEveryone(msg.id)} className="text-rose-300 hover:text-rose-200 font-medium">
                      Delete Everyone
                    </button>
                  )}
                  <button onClick={() => deleteForMe(msg.id)} className="text-slate-200 hover:text-white font-medium">
                    Delete Me
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Footer */}
      <footer className="bg-white border-t border-slate-200 p-3 shadow-md">
        <div className="flex items-center gap-2 max-w-4xl mx-auto">
          <label className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 cursor-pointer transition text-slate-700">
            📷
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>

          <button 
            type="button" 
            onMouseDown={startRecording} 
            onMouseUp={stopRecording} 
            onTouchStart={startRecording} 
            onTouchEnd={stopRecording} 
            className={`p-2.5 rounded-xl border transition ${isRecording ? 'bg-rose-500 text-white border-rose-600 animate-pulse' : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'}`}
            title="Hold to record voice note"
          >
            🎙️
          </button>

          <input 
            type="text" 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && sendMessage("text", inputText)}
            placeholder="Type encrypted message..." 
            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-slate-500 transition"
          />

          <button 
            onClick={() => sendMessage("text", inputText)} 
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-md transition text-sm"
          >
            Send
          </button>
        </div>
      </footer>

      {/* Admin Password Reset Modal */}
      {showAdminPanel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-slate-900">⚙️ Admin Control Panel</h3>
              <button onClick={() => setShowAdminPanel(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            <p className="text-xs text-slate-500 mb-4">
              As an Admin, you can assist users who forgot their credentials by resetting their password below.
            </p>

            {adminSuccessMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs text-center font-medium">
                {adminSuccessMsg}
              </div>
            )}

            <form onSubmit={handleAdminPasswordReset} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-600 font-semibold mb-1">Target Username</label>
                <input 
                  type="text" 
                  value={resetTargetUser} 
                  onChange={(e) => setResetTargetUser(e.target.value)} 
                  placeholder="e.g. tijani" 
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm"
                  required 
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-600 font-semibold mb-1">New Password</label>
                <input 
                  type="password" 
                  value={newPasswordForUser} 
                  onChange={(e) => setNewPasswordForUser(e.target.value)} 
                  placeholder="Enter new password..." 
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm"
                  required 
                />
              </div>

              <button 
                type="submit" 
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-sm transition"
              >
                Reset User Password
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div onClick={() => setLightboxImage(null)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <img src={lightboxImage} alt="Fullscreen preview" className="max-w-full max-h-full rounded-2xl border border-white/20" />
        </div>
      )}
    </div>
  );
}
