import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { 
  getFirestore, collection, addDoc, query, orderBy, 
  onSnapshot, deleteDoc, doc, setDoc, getDocs 
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

// Web Crypto API helper for AES-GCM 256-bit E2EE
async function getCryptoKey(passphrase) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("secure-chat-static-salt-v1"),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(plaintext, passphrase) {
  try {
    const key = await getCryptoKey(passphrase);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${cipherHex}`;
  } catch (e) {
    console.error("Encryption error", e);
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
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return "[Encrypted Message / Wrong Passphrase]";
  }
}

export default function ChatApp() {
  const [passphrase, setPassphrase] = useState("my-secret-room-key");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [username, setUsername] = useState("");
  const [avatarImage, setAvatarImage] = useState(null);
  const [room, setRoom] = useState("main-room");
  
  // Search & directory states
  const [searchQuery, setSearchQuery] = useState("");
  const [activeUsers, setActiveUsers] = useState([]);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [profiles, setProfiles] = useState({});
  
  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Image lightbox
  const [lightboxImage, setLightboxImage] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isUnlocked) return;

    // Real-time messages listener
    const q = query(collection(db, "chats", room, "messages"), orderBy("timestamp", "asc"));
    const unsubscribeMessages = onSnapshot(q, async (snapshot) => {
      const loadedMsgs = [];
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const decryptedText = await decryptData(data.ciphertext, passphrase);
        loadedMsgs.push({
          id: docSnap.id,
          ...data,
          decryptedText
        });
      }
      setMessages(loadedMsgs);
    });

    // Real-time profiles listener for this room
    const unsubProfiles = onSnapshot(collection(db, "chats", room, "profiles"), (snapshot) => {
      const profs = {};
      const usersList = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        profs[doc.id] = data;
        usersList.push(data);
      });
      setProfiles(profs);
      setActiveUsers(usersList);
    });

    return () => {
      unsubscribeMessages();
      unsubProfiles();
    };
  }, [isUnlocked, room, passphrase]);

  const handleAvatarFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) return;
    setIsUnlocked(true);

    try {
      await setDoc(doc(db, "chats", room, "profiles", cleanUsername), {
        username: cleanUsername,
        displayName: username.trim(),
        avatarImage: avatarImage || "https://api.dicebear.com/7.x/bottts/svg?seed=" + cleanUsername,
        lastSeen: Date.now()
      });
    } catch (err) {
      console.error("Error saving profile", err);
    }
  };

  const sendMessage = async (type = "text", content = inputText) => {
    if (!content.trim() && type === "text") return;
    const ciphertext = await encryptData(content, passphrase);

    await addDoc(collection(db, "chats", room, "messages"), {
      sender: username.trim().toLowerCase(),
      type, // 'text', 'image', 'audio'
      ciphertext,
      timestamp: Date.now(),
      deletedFor: []
    });

    if (type === "text") setInputText("");
  };

  const deleteForEveryone = async (msgId) => {
    try {
      await deleteDoc(doc(db, "chats", room, "messages", msgId));
    } catch (e) {
      console.error("Error deleting for everyone", e);
    }
  };

  const deleteForMe = (msgId) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId) {
        const hiddenList = m.deletedFor || [];
        return { ...m, deletedFor: [...hiddenList, username.trim().toLowerCase()] };
      }
      return m;
    }));
  };

  // Fixed Voice recording handlers with MIME type fallback
  const startRecording = async () => {
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      
      mediaRecorderRef.current.onstop = async () => {
        const audioBlobObj = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlobObj);
        reader.onloadend = async () => {
          const base64Audio = reader.result;
          await sendMessage("audio", base64Audio);
        };
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied or unsupported on this browser.");
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
    reader.onloadend = async () => {
      const base64Image = reader.result;
      await sendMessage("image", base64Image);
    };
    reader.readAsDataURL(file);
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-indigo-950 flex items-center justify-center p-4 font-sans text-white">
        <div className="bg-slate-900/80 backdrop-blur-xl border border-violet-500/30 p-8 rounded-3xl shadow-2xl w-full max-w-md">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🛡️</div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Secure E2EE Chat</h1>
            <p className="text-slate-400 text-sm mt-1">Encrypted messaging with photo avatars</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs uppercase tracking-wider text-violet-300 font-semibold mb-2">Unique Username</label>
              <input 
                type="text" 
                value={username} 
                onChange={(e) => setUsername(e.target.value)} 
                placeholder="e.g. tijani_dev" 
                className="w-full bg-slate-950/60 border border-violet-500/30 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition"
                required 
              />
            </div>
            
            <div>
              <label className="block text-xs uppercase tracking-wider text-violet-300 font-semibold mb-2">Profile Photo</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-violet-950 border border-violet-500/40 overflow-hidden flex items-center justify-center">
                  {avatarImage ? (
                    <img src={avatarImage} alt="Avatar preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">📷</span>
                  )}
                </div>
                <label className="flex-1 py-2.5 px-4 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold cursor-pointer text-center transition">
                  Upload Photo
                  <input type="file" accept="image/*" onChange={handleAvatarFileSelect} className="hidden" />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-violet-300 font-semibold mb-2">Shared Room & Passphrase</label>
              <input 
                type="text" 
                value={room} 
                onChange={(e) => setRoom(e.target.value)} 
                placeholder="Room name..." 
                className="w-full bg-slate-950/60 border border-violet-500/30 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 mb-3 transition"
                required 
              />
              <input 
                type="password" 
                value={passphrase} 
                onChange={(e) => setPassphrase(e.target.value)} 
                placeholder="Shared secret key..." 
                className="w-full bg-slate-950/60 border border-violet-500/30 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition"
                required 
              />
            </div>
            <button 
              type="submit" 
              className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-600/30 transition transform active:scale-95"
            >
              Enter Secure Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredUsers = activeUsers.filter(u => 
    u.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-slate-900/90 backdrop-blur-md border-b border-violet-500/20 px-4 py-3 flex flex-col gap-3 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img 
              src={avatarImage || "https://api.dicebear.com/7.x/bottts/svg?seed=" + username} 
              alt="My avatar" 
              className="w-10 h-10 rounded-xl object-cover border border-violet-500/40" 
            />
            <div>
              <h2 className="font-bold text-base flex items-center gap-2">
                {username} <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
              </h2>
              <p className="text-xs text-violet-400/80 font-mono">Room: {room}</p>
            </div>
          </div>
          <button 
            onClick={() => setIsUnlocked(false)} 
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 border border-slate-700 hover:border-rose-500/40 transition text-slate-300 hover:text-rose-300"
          >
            Switch Room
          </button>
        </div>

        {/* User Search Bar & Active Peers Directory */}
        <div className="flex items-center gap-2 bg-slate-950/60 border border-violet-500/20 rounded-xl px-3 py-1.5">
          <span className="text-sm">🔍</span>
          <input 
            type="text" 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            placeholder="Search active users in room..." 
            className="bg-transparent text-xs w-full focus:outline-none text-white placeholder-slate-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-xs text-slate-400 hover:text-white">✕</button>
          )}
        </div>

        {/* Horizontal Active Users Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 font-mono text-[10px] uppercase">Active:</span>
          {filteredUsers.map(u => (
            <div key={u.username} className="flex items-center gap-1.5 bg-violet-950/50 border border-violet-500/30 px-2.5 py-1 rounded-full whitespace-nowrap">
              <img src={u.avatarImage} alt="" className="w-4 h-4 rounded-full object-cover" />
              <span>{u.displayName}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        {messages.map((msg) => {
          const myKey = username.trim().toLowerCase();
          if (msg.deletedFor && msg.deletedFor.includes(myKey)) return null;
          const isMe = msg.sender === myKey;
          const senderProfile = profiles[msg.sender] || { 
            displayName: msg.sender, 
            avatarImage: "https://api.dicebear.com/7.x/bottts/svg?seed=" + msg.sender 
          };

          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              <img src={senderProfile.avatarImage} alt="" className="w-8 h-8 rounded-xl object-cover mb-1 border border-violet-500/30" />
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-lg relative group border ${isMe ? 'bg-gradient-to-br from-violet-600 to-indigo-600 border-violet-400/30 text-white rounded-br-none' : 'bg-slate-900/90 border-slate-800 text-slate-100 rounded-bl-none'}`}>
                
                <div className="flex items-center justify-between gap-4 mb-1 text-[11px] opacity-80">
                  <span className="font-semibold">{senderProfile.displayName}</span>
                  <span className="font-mono">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                {/* Message Content Type */}
                {msg.type === 'text' && (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.decryptedText}</p>
                )}
                {msg.type === 'image' && (
                  <img 
                    src={msg.decryptedText} 
                    alt="Shared media" 
                    onClick={() => setLightboxImage(msg.decryptedText)}
                    className="rounded-xl max-h-60 w-full object-cover cursor-pointer hover:opacity-95 transition mt-1 border border-white/10" 
                  />
                )}
                {msg.type === 'audio' && (
                  <audio controls src={msg.decryptedText} className="mt-1 h-9 w-52 accent-violet-400"></audio>
                )}

                {/* Delete Menu */}
                <div className={`absolute top-2 ${isMe ? 'left-2' : 'right-2'} opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded-lg border border-violet-500/30 text-[10px]`}>
                  {isMe && (
                    <button onClick={() => deleteForEveryone(msg.id)} className="text-rose-400 hover:text-rose-300 font-medium">
                      Delete Everyone
                    </button>
                  )}
                  <button onClick={() => deleteForMe(msg.id)} className="text-slate-300 hover:text-white font-medium">
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
      <footer className="bg-slate-900/90 backdrop-blur-md border-t border-violet-500/20 p-3">
        <div className="flex items-center gap-2 max-w-4xl mx-auto">
          <label className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-violet-600/30 border border-slate-700 hover:border-violet-500/40 cursor-pointer transition text-violet-400">
            📷
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>

          <button 
            type="button" 
            onMouseDown={startRecording} 
            onMouseUp={stopRecording} 
            onTouchStart={startRecording} 
            onTouchEnd={stopRecording} 
            className={`p-2.5 rounded-xl border transition ${isRecording ? 'bg-rose-600 text-white border-rose-400 animate-pulse' : 'bg-slate-800/80 text-violet-400 border-slate-700 hover:border-violet-500/40'}`}
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
            className="flex-1 bg-slate-950/80 border border-violet-500/30 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition"
          />

          <button 
            onClick={() => sendMessage("text", inputText)} 
            className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-600/30 transition text-sm"
          >
            Send
          </button>
        </div>
      </footer>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div onClick={() => setLightboxImage(null)} className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <img src={lightboxImage} alt="Fullscreen preview" className="max-w-full max-h-full rounded-2xl border border-violet-500/40" />
        </div>
      )}
    </div>
  );
}
