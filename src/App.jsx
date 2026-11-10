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
  const [errorMessage, setErrorMessage] = useState("");
  
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
    setErrorMessage("");
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) return;

    try {
      // Unique Username check in room profiles
      const userRef = doc(db, "chats", room, "profiles", cleanUsername);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        setErrorMessage("⚠️ This username is already taken. Please choose another one.");
        return;
      }

      await setDoc(userRef, {
        username: cleanUsername,
        displayName: username.trim(),
        avatarImage: avatarImage || "https://api.dicebear.com/7.x/bottts/svg?seed=" + cleanUsername,
        lastSeen: Date.now()
      });

      setIsUnlocked(true);
    } catch (err) {
      console.error("Error registering username", err);
      setErrorMessage("Connection error. Please try again.");
    }
  };

  const sendMessage = async (type = "text", content = inputText) => {
    if (!content.trim() && type === "text") return;
    const ciphertext = await encryptData(content, passphrase);

    await addDoc(collection(db, "chats", room, "messages"), {
      sender: username.trim().toLowerCase(),
      type, 
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
      <div className="min-h-screen bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700 flex items-center justify-center p-4 font-sans text-slate-800">
        <div className="bg-white/95 backdrop-blur-xl border border-blue-200 p-8 rounded-3xl shadow-2xl w-full max-w-md">
          <div className="text-center mb-6">
            <div className="text-5xl mb-2">💬</div>
            <h1 className="text-2xl font-bold text-blue-600">Secure E2EE Chat</h1>
            <p className="text-slate-500 text-sm mt-1">Encrypted messaging with unique handles</p>
          </div>

          {errorMessage && (
            <div className="mb-5 p-3 rounded-xl bg-rose-100 border border-rose-300 text-rose-600 text-xs text-center font-medium">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-blue-700 font-semibold mb-1">Unique Username</label>
              <input 
                type="text" 
                value={username} 
                onChange={(e) => { setUsername(e.target.value); setErrorMessage(""); }} 
                placeholder="e.g. tijani" 
                className="w-full bg-slate-50 border border-blue-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-blue-500 transition"
                required 
              />
            </div>
            
            <div>
              <label className="block text-xs uppercase tracking-wider text-blue-700 font-semibold mb-1">Profile Photo</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200 overflow-hidden flex items-center justify-center">
                  {avatarImage ? (
                    <img src={avatarImage} alt="Avatar preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">📷</span>
                  )}
                </div>
                <label className="flex-1 py-2.5 px-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl text-xs font-semibold cursor-pointer text-blue-600 text-center transition">
                  Upload Photo
                  <input type="file" accept="image/*" onChange={handleAvatarFileSelect} className="hidden" />
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wider text-blue-700 font-semibold mb-1">Shared Room & Passphrase</label>
              <input 
                type="text" 
                value={room} 
                onChange={(e) => setRoom(e.target.value)} 
                placeholder="Room name..." 
                className="w-full bg-slate-50 border border-blue-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-blue-500 mb-3 transition"
                required 
              />
              <input 
                type="password" 
                value={passphrase} 
                onChange={(e) => setPassphrase(e.target.value)} 
                placeholder="Shared secret key..." 
                className="w-full bg-slate-50 border border-blue-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-blue-500 transition"
                required 
              />
            </div>
            <button 
              type="submit" 
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/30 transition transform active:scale-95"
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
    <div className="flex flex-col h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-blue-100 px-4 py-3 flex flex-col gap-3 shadow-sm z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img 
              src={avatarImage || "https://api.dicebear.com/7.x/bottts/svg?seed=" + username} 
              alt="My avatar" 
              className="w-10 h-10 rounded-xl object-cover border border-blue-200" 
            />
            <div>
              <h2 className="font-bold text-base text-slate-900 flex items-center gap-2">
                {username} <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              </h2>
              <p className="text-xs text-blue-600 font-mono">Room: {room}</p>
            </div>
          </div>
          <button 
            onClick={() => setIsUnlocked(false)} 
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-medium transition"
          >
            Switch Room
          </button>
        </div>

        {/* User Search Bar */}
        <div className="flex items-center gap-2 bg-slate-100 border border-blue-100 rounded-xl px-3 py-1.5">
          <span className="text-sm text-slate-400">🔍</span>
          <input 
            type="text" 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            placeholder="Search active users in room..." 
            className="bg-transparent text-xs w-full focus:outline-none text-slate-800 placeholder-slate-400"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
          )}
        </div>

        {/* Horizontal Active Users Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-blue-600 font-semibold text-[10px] uppercase">Active:</span>
          {filteredUsers.map(u => (
            <div key={u.username} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full whitespace-nowrap text-blue-900 font-medium">
              <img src={u.avatarImage} alt="" className="w-4 h-4 rounded-full object-cover" />
              <span>{u.displayName}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-blue-50/40 via-white to-blue-50/30">
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
              <img src={senderProfile.avatarImage} alt="" className="w-8 h-8 rounded-xl object-cover mb-1 border border-blue-200" />
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-md relative group border ${isMe ? 'bg-blue-600 border-blue-600 text-white rounded-br-none' : 'bg-white border-blue-100 text-slate-800 rounded-bl-none'}`}>
                
                <div className={`flex items-center justify-between gap-4 mb-1 text-[11px] ${isMe ? 'text-blue-100' : 'text-slate-400'}`}>
                  <span className="font-semibold">{senderProfile.displayName}</span>
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
                    className="rounded-xl max-h-60 w-full object-cover cursor-pointer hover:opacity-95 transition mt-1 border border-blue-100" 
                  />
                )}
                {msg.type === 'audio' && (
                  <audio controls src={msg.decryptedText} className="mt-1 h-9 w-52 accent-blue-600"></audio>
                )}

                {/* Delete Menu */}
                <div className={`absolute top-2 ${isMe ? 'left-2' : 'right-2'} opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-slate-900/80 text-white backdrop-blur-md px-2 py-1 rounded-lg text-[10px]`}>
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
      <footer className="bg-white border-t border-blue-100 p-3 shadow-lg">
        <div className="flex items-center gap-2 max-w-4xl mx-auto">
          <label className="p-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 cursor-pointer transition text-blue-600">
            📷
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>

          <button 
            type="button" 
            onMouseDown={startRecording} 
            onMouseUp={stopRecording} 
            onTouchStart={startRecording} 
            onTouchEnd={stopRecording} 
            className={`p-2.5 rounded-xl border transition ${isRecording ? 'bg-rose-500 text-white border-rose-600 animate-pulse' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
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
            className="flex-1 bg-slate-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500 transition"
          />

          <button 
            onClick={() => sendMessage("text", inputText)} 
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md shadow-blue-500/20 transition text-sm"
          >
            Send
          </button>
        </div>
      </footer>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div onClick={() => setLightboxImage(null)} className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <img src={lightboxImage} alt="Fullscreen preview" className="max-w-full max-h-full rounded-2xl border border-white/20" />
        </div>
      )}
    </div>
  );
}
