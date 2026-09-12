import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';

// ── Helpers ──
function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
    return d.toLocaleDateString();
}

function getInitials(name: string | null | undefined): string {
    if (!name) return '?';
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarClass(id: string): string {
    const num = (id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % 7 + 1;
    return `avatar-gradient-${num}`;
}

function formatFileSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Voice Player Component ──
function VoicePlayer({ src }: { src: string }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [maxTime, setMaxTime] = useState(0); // track max currentTime for Infinity duration
    const [error, setError] = useState<string | null>(null);
    const [waveform] = useState(() =>
        Array.from({ length: 28 }, () => 8 + Math.random() * 24)
    );

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = 1;
        if (error) {
            // Retry on error
            setError(null);
            audio.load();
            audio.play().catch((err) => {
                console.error('🔊 Audio play error:', err);
                setError(err.message);
            });
            return;
        }
        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch((err) => {
                console.error('🔊 Audio play error:', err);
                setError(err.message);
            });
        }
    };

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = 1;

        const onPlay = () => { console.log('🔊 Playing:', src); setIsPlaying(true); };
        const onPause = () => setIsPlaying(false);
        const onEnded = () => {
            setIsPlaying(false);
            // When ended, currentTime is the real duration for WebM (which reports Infinity)
            if (!isFinite(duration) || duration === 0) {
                setDuration(audio.currentTime || maxTime);
            }
            setCurrentTime(0);
        };
        const onTimeUpdate = () => {
            const t = audio.currentTime;
            setCurrentTime(t);
            if (t > maxTime) setMaxTime(t);
        };
        const onLoadedMetadata = () => {
            const d = audio.duration;
            console.log('🔊 Audio loaded, duration:', d, 'src:', src);
            if (isFinite(d) && d > 0) {
                setDuration(d);
            }
        };
        const onDurationChange = () => {
            const d = audio.duration;
            if (isFinite(d) && d > 0) {
                setDuration(d);
            }
        };
        const onError = () => {
            const e = audio.error;
            console.error('🔊 Audio error:', e?.code, e?.message, 'src:', src);
            setError(`Audio error: ${e?.message || 'unknown'}`);
        };

        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('durationchange', onDurationChange);
        audio.addEventListener('error', onError);

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('durationchange', onDurationChange);
            audio.removeEventListener('error', onError);
        };
    }, [src]);

    // For WebM with Infinity duration, use currentTime for progress
    const effectiveDuration = (isFinite(duration) && duration > 0) ? duration : maxTime || 0;
    const progress = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0;
    const activeBars = Math.floor((progress / 100) * waveform.length);

    const handleBarClick = (index: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        // Only allow seeking if we have a finite duration
        if (isFinite(duration) && duration > 0) {
            audio.currentTime = (index / waveform.length) * duration;
        }
    };

    const displayTime = isPlaying
        ? formatDuration(currentTime)
        : effectiveDuration > 0 ? formatDuration(effectiveDuration) : '0:00';

    return (
        <div className="voice-player">
            <audio ref={audioRef} src={src} preload="auto" />
            <button className="voice-play-btn" onClick={togglePlay} type="button">
                {error ? '⚠️' : isPlaying ? '⏸' : '▶'}
            </button>
            <div className="voice-waveform">
                {waveform.map((h: number, i: number) => (
                    <div
                        key={i}
                        className={`voice-bar ${i < activeBars ? 'active' : ''}`}
                        style={{ height: `${h}px` }}
                        onClick={() => handleBarClick(i)}
                    />
                ))}
            </div>
            <span className="voice-duration">
                {displayTime}
            </span>
        </div>
    );
}

function VideoMessage({ src }: { src: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            video.play().then(() => setPlaying(true)).catch(() => undefined);
        } else {
            video.pause();
            setPlaying(false);
        }
    };

    return <div className="video-message-player">
        <video
            ref={videoRef}
            className="message-video"
            src={src}
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setCurrentTime(0); }}
            onClick={togglePlay}
        />
        <div className="video-message-controls" onClick={(event) => event.stopPropagation()}>
            <button className="video-play-btn" onClick={togglePlay} type="button">{playing ? '⏸' : '▶'}</button>
            <input
                className="video-seek"
                type="range"
                min="0"
                max={duration || 0}
                step="0.01"
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => {
                    const nextTime = Number(event.target.value);
                    if (videoRef.current) videoRef.current.currentTime = nextTime;
                    setCurrentTime(nextTime);
                }}
                aria-label="Перемотка видеосообщения"
            />
            <span className="video-time">{formatDuration(currentTime)} / {formatDuration(duration)}</span>
        </div>
    </div>;
}

function playAlertSound(repeat = false) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return undefined;
    const context = new AudioContextClass();
    let stopped = false;
    let timer: number | undefined;
    const playTone = () => {
        if (stopped || context.state === 'closed') return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 880;
        oscillator.type = 'sine';
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.3);
    };
    context.resume().then(() => {
        if (!stopped) playTone();
    }).catch(() => undefined);
    if (!repeat) {
        window.setTimeout(() => context.close().catch(() => undefined), 500);
        return undefined;
    }
    timer = window.setInterval(playTone, 900);
    return () => {
        stopped = true;
        if (timer !== undefined) window.clearInterval(timer);
        context.close().catch(() => undefined);
    };
}

// ── Profile Panel Component ──
function ProfilePanel({
    user,
    onClose,
    onUpdate,
    onSaved,
}: {
    user: any;
    onClose: () => void;
    onUpdate: (data: any) => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation();
    const [displayName, setDisplayName] = useState(user?.displayName || '');
    const [username, setUsername] = useState(user?.username || '');
    const [bio, setBio] = useState(user?.bio || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const avatarInputRef = useRef<HTMLInputElement>(null);

    const handleSave = async () => {
        setError('');
        setSaving(true);
        try {
            const profileData: { displayName?: string; username?: string; bio?: string } = {};
            if (displayName.trim()) profileData.displayName = displayName.trim();
            if (username.trim()) profileData.username = username.trim();
            profileData.bio = bio.trim();
            const updated = await api.updateProfile(profileData);
            onUpdate(updated);
            onSaved();
        } catch (err: any) {
            setError(err.message || 'Не удалось сохранить профиль');
        } finally {
            setSaving(false);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const result = await api.uploadAvatar(file);
            onUpdate({ avatarUrl: result.avatarUrl });
        } catch (err: any) {
            console.error('Avatar upload failed:', err);
        }
        e.target.value = '';
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
                <div className="profile-modal-header">
                    <h3>👤 {t('profile.edit')}</h3>
                    <button className="btn-icon" onClick={onClose}>✕</button>
                </div>

                <div className="profile-avatar-section">
                    <div
                        className={`avatar avatar-xl ${getAvatarClass(user?.id || 'x')} profile-avatar-clickable`}
                        onClick={() => avatarInputRef.current?.click()}
                    >
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="" />
                        ) : (
                            getInitials(user?.displayName || user?.username)
                        )}
                        <div className="avatar-overlay">📷</div>
                    </div>
                    <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        style={{ display: 'none' }}
                        onChange={handleAvatarUpload}
                    />
                    <p className="profile-avatar-hint">{t('profile.setup')}</p>
                </div>

                <div className="input-group">
                    <label className="input-label">{t('profile.displayName')}</label>
                    <input
                        className="input"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Ваше имя"
                    />
                </div>

                <div className="input-group">
                    <label className="input-label">{t('profile.username')}</label>
                    <input
                        className="input"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32))}
                        disabled={Boolean(user?.username)}
                        placeholder="username"
                    />
                    {user?.username && <span className="form-hint">@username нельзя изменить после создания.</span>}
                </div>

                <div className="input-group">
                    <label className="input-label">{t('profile.bio')}</label>
                    <textarea
                        className="input"
                        value={bio}
                        onChange={(e) => setBio(e.target.value.slice(0, 200))}
                        placeholder="О себе..."
                        rows={3}
                        style={{ resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
                        {bio.length}/200
                    </div>
                </div>

                {error && <div className="login-error">{error}</div>}

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        {saving ? '...' : t('profile.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════
// ── MAIN CHAT PAGE ──
// ══════════════════════════════════════════════
export default function ChatPage() {
    const { t, i18n } = useTranslation();
    const { chatId } = useParams();
    const navigate = useNavigate();

    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const setUser = useAuthStore((s) => s.setUser);
    const updateUser = useAuthStore((s) => s.updateUser);

    const {
        chats, setChats, activeChat, setActiveChat,
        messages, setMessages, addMessage, updateMessage, deleteMessage,
        typingUsers, setTyping, setUserStatus, onlineUsers, lastSeenUsers,
    } = useChatStore();

    const [messageText, setMessageText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [showNewChat, setShowNewChat] = useState(false);
    const [showNewGroup, setShowNewGroup] = useState(false);
    const [showNewChannel, setShowNewChannel] = useState(false);
    const [showCreateMenu, setShowCreateMenu] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [channelName, setChannelName] = useState('');
    const [channelUsername, setChannelUsername] = useState('');
    const [channelDescription, setChannelDescription] = useState('');
    const [channelPublic, setChannelPublic] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [settingsTab, setSettingsTab] = useState<'profile' | 'theme' | 'language' | 'notifications'>('profile');
    const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') as 'light' | 'dark') || 'dark');
    const [isVideoRecording, setIsVideoRecording] = useState(false);
    const [videoRecordingTime, setVideoRecordingTime] = useState(0);
    const [isVideoPaused, setIsVideoPaused] = useState(false);
    const [videoError, setVideoError] = useState('');
    const videoPreviewRef = useRef<HTMLVideoElement>(null);
    const videoRecordingStreamRef = useRef<MediaStream | null>(null);
    const videoRecorderRef = useRef<MediaRecorder | null>(null);
    const videoChunksRef = useRef<Blob[]>([]);
    const videoTimerRef = useRef<ReturnType<typeof setInterval>>();
    const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
    const [incomingCall, setIncomingCall] = useState<{ chatId: string; callType: 'audio' | 'video'; offer: RTCSessionDescriptionInit } | null>(null);
    const [isCallMuted, setIsCallMuted] = useState(false);
    const [callId, setCallId] = useState<string | null>(null);
    const [showContacts, setShowContacts] = useState(false);
    const [showCalls, setShowCalls] = useState(false);
    const [showChatMenu, setShowChatMenu] = useState(false);
    const [showAddMember, setShowAddMember] = useState(false);
    const [contacts, setContacts] = useState<any[]>([]);
    const [calls, setCalls] = useState<any[]>([]);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const callStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);
    const [showProfile, setShowProfile] = useState(false);
    const [replyTo, setReplyTo] = useState<any>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [activeFolder, setActiveFolder] = useState<string>('all');
    const [socketReady, setSocketReady] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const settingsAvatarInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const recordingTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const chatRequestRef = useRef(0);
    const ringtoneStopRef = useRef<(() => void) | undefined>();
    const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('notificationsEnabled') !== 'false');
    const [profileDraft, setProfileDraft] = useState({ displayName: '', surname: '', username: '', bio: '' });
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileError, setProfileError] = useState('');

    useEffect(() => {
        if (!user) return;
        setProfileDraft({
            displayName: user.displayName || '',
            surname: user.surname || '',
            username: user.username || '',
            bio: user.bio || '',
        });
    }, [user?.id]);

    const toggleNotifications = async () => {
        if (!notificationsEnabled && 'Notification' in window && Notification.permission !== 'granted') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return;
        }
        const enabled = !notificationsEnabled;
        setNotificationsEnabled(enabled);
        localStorage.setItem('notificationsEnabled', String(enabled));
    };

    const notifyNewMessage = (message: any) => {
        if (!notificationsEnabled || message.senderId === user?.id) return;
        playAlertSound();
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            new Notification(message.sender?.displayName || 'Новое сообщение', {
                body: message.content || 'Новое сообщение',
                tag: `chat-${message.chatId}`,
            });
        }
    };

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        if (callType) {
            if (localVideoRef.current && callStreamRef.current) localVideoRef.current.srcObject = callStreamRef.current;
            if (remoteVideoRef.current && remoteStreamRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
            if (remoteAudioRef.current && remoteStreamRef.current) remoteAudioRef.current.srcObject = remoteStreamRef.current;
            return;
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
        remoteStreamRef.current = null;
    }, [callType]);

    useEffect(() => {
        if (isVideoRecording && videoPreviewRef.current && videoRecordingStreamRef.current) {
            videoPreviewRef.current.srcObject = videoRecordingStreamRef.current;
        }
    }, [isVideoRecording]);

    // ── STEP 1: Connect socket FIRST, then fetch data ──
    useEffect(() => {
        const token = localStorage.getItem('accessToken');
        if (token) {
            socketService.connect(token);
        }

        // Small delay to let socket establish, then fetch data
        const fetchData = async () => {
            try {
                const me = await api.getMe();
                setUser(me);
                const favorites = await api.getFavorites();
                const chatList = await api.getChats();
                setChats([favorites, ...chatList.filter((chat: any) => chat.id !== favorites.id)]);
                // Mark socket as ready AFTER connection and data load
                setSocketReady(true);
            } catch (error: any) {
                if (error?.message === 'Unauthorized') {
                    logout();
                    navigate('/login');
                } else {
                    console.error('Failed to load account data:', error);
                }
            }
        };
        fetchData();

        return () => {
            socketService.removeAllListeners();
            socketService.disconnect();
        };
    }, []);

    useEffect(() => {
        const timer = window.setInterval(async () => {
            try {
                const chatList = await api.getChats();
                setChats(chatList);
                if (chatId && !chatList.some((chat: any) => chat.id === chatId)) {
                    setActiveChat(null);
                    navigate('/chat');
                }
            } catch { }
        }, 3000);
        return () => window.clearInterval(timer);
    }, [chatId]);

    // ── STEP 2: Attach socket listeners only when socket is ready and user is loaded ──
    useEffect(() => {
        if (!socketReady || !user?.id) return;

        const handleNewMessage = (message: any) => {
            console.log('📩 New message received:', message.id);
            addMessage(message);
            notifyNewMessage(message);
        };
        const handleTypingStart = (data: any) => {
            if (data.userId !== user.id) setTyping(data.chatId, data.userId, true);
        };
        const handleTypingStop = (data: any) => setTyping(data.chatId, data.userId, false);
        const handleMessageEdited = (message: any) => updateMessage(message);
        const handleMessageDeleted = (data: any) => deleteMessage(data.chatId, data.messageId);
        const handleUserStatus = (data: any) => setUserStatus(data.userId, data.isOnline, data.lastSeen);
        const handleCallSignal = async (data: any) => {
            if (data.type === 'offer') {
                if (data.chatId !== chatId) navigate(`/chat/${data.chatId}`);
                setIncomingCall({ chatId: data.chatId, callType: data.callType, offer: data.offer });
                ringtoneStopRef.current?.();
                ringtoneStopRef.current = playAlertSound(true);
            } else if (data.type === 'answer' && peerRef.current) {
                await peerRef.current.setRemoteDescription(data.answer);
                for (const candidate of pendingIceCandidatesRef.current.splice(0)) {
                    await peerRef.current.addIceCandidate(candidate).catch(() => undefined);
                }
            } else if (data.type === 'candidate') {
                if (!peerRef.current || !peerRef.current.remoteDescription) {
                    pendingIceCandidatesRef.current.push(data.candidate);
                } else {
                    await peerRef.current.addIceCandidate(data.candidate).catch(() => undefined);
                }
            } else if (data.type === 'reject') {
                ringtoneStopRef.current?.();
                ringtoneStopRef.current = undefined;
                peerRef.current?.close();
                callStreamRef.current?.getTracks().forEach((track) => track.stop());
                remoteStreamRef.current = null;
                setCallType(null);
                setCallId(null);
                alert('Звонок отклонён');
            } else if (data.type === 'hangup') {
                ringtoneStopRef.current?.();
                ringtoneStopRef.current = undefined;
                peerRef.current?.close();
                callStreamRef.current?.getTracks().forEach((track) => track.stop());
                remoteStreamRef.current = null;
                peerRef.current = null;
                setCallType(null);
                setIncomingCall(null);
            }
        };

        socketService.onNewMessage(handleNewMessage);
        socketService.onTypingStart(handleTypingStart);
        socketService.onTypingStop(handleTypingStop);
        socketService.onMessageEdited(handleMessageEdited);
        socketService.onMessageDeleted(handleMessageDeleted);
        socketService.onUserStatus(handleUserStatus);
        socketService.onCallSignal(handleCallSignal);

        return () => {
            ringtoneStopRef.current?.();
            ringtoneStopRef.current = undefined;
            socketService.offNewMessage(handleNewMessage);
            socketService.offTypingStart(handleTypingStart);
            socketService.offTypingStop(handleTypingStop);
            socketService.offMessageEdited(handleMessageEdited);
            socketService.offMessageDeleted(handleMessageDeleted);
            socketService.offUserStatus(handleUserStatus);
            socketService.offCallSignal(handleCallSignal);
        };
    }, [socketReady, user?.id, chatId]);

    const answerIncomingCall = async () => {
        if (!incomingCall) return;
        ringtoneStopRef.current?.();
        ringtoneStopRef.current = undefined;
        setIncomingCall(null);
        try {
            const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            peerRef.current = peer;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: incomingCall.callType === 'video' ? { facingMode: 'user' } : false,
            });
            callStreamRef.current = stream;
            stream.getTracks().forEach((track) => peer.addTrack(track, stream));
            peer.ontrack = (event) => {
                const remoteStream = event.streams[0] || new MediaStream([event.track]);
                remoteStreamRef.current = remoteStream;
                if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
                if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
            };
            peer.onicecandidate = (event) => event.candidate && socketService.sendCallSignal({ chatId: incomingCall.chatId, type: 'candidate', candidate: event.candidate });
            await peer.setRemoteDescription(incomingCall.offer);
            for (const candidate of pendingIceCandidatesRef.current.splice(0)) {
                await peer.addIceCandidate(candidate).catch(() => undefined);
            }
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socketService.sendCallSignal({ chatId: incomingCall.chatId, type: 'answer', answer });
            setCallType(incomingCall.callType);
        } catch (error) {
            console.error('Answer call failed:', error);
            rejectIncomingCall();
        }
    };

    const rejectIncomingCall = () => {
        ringtoneStopRef.current?.();
        ringtoneStopRef.current = undefined;
        if (incomingCall) socketService.sendCallSignal({ chatId: incomingCall.chatId, type: 'reject' });
        setIncomingCall(null);
    };

    const startCall = async (type: 'audio' | 'video') => {
        if (!chatId || isChannel) return;
        try {
            const savedCall = await api.startCall(chatId, type === 'video' ? 'VIDEO' : 'AUDIO');
            setCallId(savedCall.id);
            const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            peerRef.current = peer;
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: type === 'video' ? { facingMode: 'user' } : false,
            });
            callStreamRef.current = stream;
            stream.getTracks().forEach((track) => peer.addTrack(track, stream));
            peer.ontrack = (event) => {
                const remoteStream = event.streams[0] || new MediaStream([event.track]);
                remoteStreamRef.current = remoteStream;
                if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
                if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
            };
            peer.onicecandidate = (event) => event.candidate && socketService.sendCallSignal({ chatId, type: 'candidate', candidate: event.candidate });
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            setCallType(type);
            socketService.sendCallSignal({ chatId, type: 'offer', offer, callType: type });
        } catch (error) {
            console.error('Call failed:', error);
            peerRef.current?.close();
            callStreamRef.current?.getTracks().forEach((track) => track.stop());
            peerRef.current = null;
            callStreamRef.current = null;
            setCallId(null);
            alert(error instanceof DOMException && error.name === 'NotAllowedError'
                ? 'Доступ к микрофону или камере запрещён. Разрешите его в настройках браузера и повторите звонок.'
                : 'Не удалось начать звонок. Проверьте доступ к микрофону и камере.');
        }
    };

    const endCall = () => {
        ringtoneStopRef.current?.();
        ringtoneStopRef.current = undefined;
        if (chatId) socketService.sendCallSignal({ chatId, type: 'hangup' });
        if (callId) api.endCall(callId).catch(() => { });
        peerRef.current?.close();
        callStreamRef.current?.getTracks().forEach((track) => track.stop());
        remoteStreamRef.current = null;
        pendingIceCandidatesRef.current = [];
        setCallType(null);
        setCallId(null);
        setIsCallMuted(false);
        setIncomingCall(null);
    };

    const toggleCallMute = () => {
        const nextMuted = !isCallMuted;
        callStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
        setIsCallMuted(nextMuted);
    };

    const openContacts = async () => {
        setShowCalls(false);
        setShowContacts(true);
        try {
            const contactPicker = (navigator as any).contacts;
            if (contactPicker?.select) {
                const picked = await contactPicker.select(['name', 'tel'], { multiple: true });
                const phones = picked.flatMap((contact: any) => contact.tel || []);
                setContacts(await api.getPhonebookContacts(phones));
            } else {
                setContacts([]);
            }
        } catch (error) { console.error('Contacts loading failed:', error); setContacts([]); }
    };

    const openCalls = async () => {
        setShowContacts(false);
        setShowCalls(true);
        try { setCalls(await api.getCalls()); } catch (error) { console.error('Calls loading failed:', error); }
    };

    const leaveCurrentChat = async () => {
        if (!chatId || !confirm('Выйти из этого чата?')) return;
        await api.leaveChat(chatId);
        setChats(chats.filter((chat) => chat.id !== chatId));
        setShowChatMenu(false);
        navigate('/chat');
    };

    const deleteCurrentChat = async () => {
        if (!chatId || !confirm('Удалить этот чат для всех участников?')) return;
        await api.deleteChat(chatId);
        setChats(chats.filter((chat) => chat.id !== chatId));
        setShowChatMenu(false);
        navigate('/chat');
    };

    const toggleChatMute = async () => {
        if (!chatId || !currentMember) return;
        const result = await api.setChatMuted(chatId, !isChatMuted);
        if (activeChat) {
            setActiveChat({
                ...activeChat,
                members: activeChat.members.map((member: any) => member.userId === user?.id
                    ? { ...member, mutedUntil: result.muted ? '2099-12-31T23:59:59.999Z' : null }
                    : member),
            });
        }
    };

    const addMemberToChat = async (memberId: string) => {
        if (!chatId) return;
        await api.addChatMember(chatId, memberId);
        setShowAddMember(false);
        setSearchQuery('');
        await loadChat(chatId, chatRequestRef.current);
    };

    // ── Load chat when chatId changes ──
    useEffect(() => {
        const requestId = ++chatRequestRef.current;
        setActiveChat(null);
        if (chatId) {
            setMessages(chatId, []);
            loadChat(chatId, requestId);
        }
        setShowContacts(false);
        setShowCalls(false);
        setShowSettings(false);
        setShowChatMenu(false);
    }, [chatId]);

    // ── Auto-scroll on new messages ──
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages[chatId || '']]);

    const loadChat = async (id: string, requestId: number) => {
        try {
            const chat = await api.getChat(id);
            if (requestId !== chatRequestRef.current) return;
            setActiveChat(chat);
            const msgData = await api.getMessages(id);
            if (requestId !== chatRequestRef.current) return;
            setMessages(id, msgData.messages);
            socketService.markRead(id);
        } catch (err) {
            console.error('Failed to load chat:', err);
        }
    };

    const getChatName = (chat: any): string => {
        if (chat.name === 'Избранное') return 'Избранное';
        if (chat.type === 'GROUP' || chat.type === 'CHANNEL') return chat.name || (chat.type === 'CHANNEL' ? 'Channel' : 'Group');
        const other = chat.members?.find((m: any) => m.user.id !== user?.id);
        return other?.user.displayName || other?.user.username || 'Chat';
    };

    const getChatAvatar = (chat: any): string | null => {
        if (chat.name === 'Избранное') return '/izbranoe.jpg';
        if (chat.type === 'GROUP' || chat.type === 'CHANNEL') return chat.avatarUrl;
        const other = chat.members?.find((m: any) => m.user.id !== user?.id);
        return other?.user.avatarUrl;
    };

    const getOtherUserId = (chat: any): string | null => {
        if (chat.type !== 'PRIVATE') return null;
        return chat.members?.find((m: any) => m.user.id !== user?.id)?.user.id || null;
    };

    const getChatAvatarId = (chat: any): string => {
        if (chat.name === 'Избранное') return 'favorites';
        if (chat.type === 'GROUP' || chat.type === 'CHANNEL') return chat.id;
        const other = chat.members?.find((m: any) => m.user.id !== user?.id);
        return other?.user.id || chat.id;
    };

    const currentMember = activeChat?.members?.find((member: any) => member.userId === user?.id);
    const isReadOnlyChannel = activeChat?.type === 'CHANNEL' && currentMember?.role === 'MEMBER';
    const isChatMuted = !!currentMember?.mutedUntil && new Date(currentMember.mutedUntil).getTime() > Date.now();
    const canDeleteActiveChat = !!activeChat && (activeChat.type === 'PRIVATE' || ['OWNER', 'ADMIN'].includes(currentMember?.role));
    const isChannel = activeChat?.type === 'CHANNEL';

    // ── Folder filtering ──
    const filteredChats = chats.filter((chat) => {
        if (activeFolder === 'all') return true;
        if (activeFolder === 'private') return chat.type === 'PRIVATE';
        if (activeFolder === 'groups') return chat.type === 'GROUP';
        if (activeFolder === 'channels') return chat.type === 'CHANNEL';
        return true;
    });

    // ── Send message ──
    const handleSendMessage = async () => {
        if (!messageText.trim() || !chatId) return;
        if (isReadOnlyChannel) return;
        const data: any = { chatId, content: messageText.trim(), type: 'TEXT' };
        if (replyTo) data.replyToId = replyTo.id;
        socketService.sendMessage(data);
        setMessageText('');
        setReplyTo(null);
        socketService.stopTyping(chatId);
    };

    const handleTyping = () => {
        if (!chatId || isReadOnlyChannel || isChannel) return;
        socketService.startTyping(chatId);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => socketService.stopTyping(chatId), 2000);
    };

    // ── File upload ──
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !chatId) return;
        try {
            const result = await api.uploadFile(file);
            const isImage = file.type.startsWith('image/');
            socketService.sendMessage({
                chatId,
                type: isImage ? 'IMAGE' : 'FILE',
                fileUrl: result.url,
                fileName: result.fileName,
                fileSize: file.size,
                mimeType: result.mimeType,
                content: isImage ? '📷 Фото' : `📎 ${result.fileName}`,
            });
        } catch (err) {
            console.error('Upload failed:', err);
        }
        e.target.value = '';
    };

    // ── Voice recording ──
    const recordingTimeRef = useRef(0);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission first to get labels
                await navigator.mediaDevices.getUserMedia({ audio: true });
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                setAudioDevices(audioInputs);
                if (audioInputs.length > 0 && !selectedDeviceId) {
                    setSelectedDeviceId(audioInputs[0].deviceId);
                }
            } catch (err) {
                console.error('Error enumerating devices:', err);
            }
        };
        getDevices();
    }, []);

    const startRecording = async () => {
        try {
            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const audioTrack = stream.getAudioTracks()[0];
            console.log('🎙️ Got mic stream, tracks:', stream.getAudioTracks().length);
            console.log('🎙️ Mic device:', audioTrack?.label || 'unknown');
            console.log('🎙️ Mic settings:', JSON.stringify(audioTrack?.getSettings()));

            // ── Web Audio API: monitor mic level ──
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            // Monitor mic levels periodically
            const levelInterval = setInterval(() => {
                analyser.getByteTimeDomainData(dataArray);
                let maxAmplitude = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const amplitude = Math.abs(dataArray[i] - 128);
                    if (amplitude > maxAmplitude) maxAmplitude = amplitude;
                }
                const level = Math.round((maxAmplitude / 128) * 100);
                console.log(`🎙️ Mic level: ${level}% (max amplitude: ${maxAmplitude}/128) ${level > 5 ? '🔊 SOUND DETECTED' : '🔇 SILENCE'}`);
            }, 1000);

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : '';
            console.log('🎙️ Using mimeType:', mimeType || '(browser default)');

            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];
            recordingTimeRef.current = 0;

            recorder.ondataavailable = (e) => {
                console.log('🎙️ Data chunk:', e.data.size, 'bytes');
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            recorder.onstop = async () => {
                // Stop mic level monitoring
                clearInterval(levelInterval);
                source.disconnect();
                audioCtx.close();

                const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
                console.log('🎙️ Recording complete. Blob size:', blob.size, 'type:', blob.type, 'chunks:', audioChunksRef.current.length);

                // ── Analyze recorded audio for actual content ──
                try {
                    const arrayBuffer = await blob.arrayBuffer();
                    const decodeCtx = new AudioContext();
                    const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
                    const channelData = audioBuffer.getChannelData(0);
                    let maxSample = 0;
                    let rms = 0;
                    for (let i = 0; i < channelData.length; i++) {
                        const abs = Math.abs(channelData[i]);
                        if (abs > maxSample) maxSample = abs;
                        rms += channelData[i] * channelData[i];
                    }
                    rms = Math.sqrt(rms / channelData.length);
                    console.log(`🎙️ Audio analysis: duration=${audioBuffer.duration.toFixed(2)}s, maxSample=${maxSample.toFixed(4)}, RMS=${rms.toFixed(6)}, sampleRate=${audioBuffer.sampleRate}`);
                    if (maxSample < 0.01) {
                        console.error('🎙️ ❌ RECORDING IS SILENT! Max sample is near zero. Check your microphone!');
                    } else {
                        console.log('🎙️ ✅ Recording contains audio data!');
                    }
                    decodeCtx.close();
                } catch (analyzeErr) {
                    console.error('🎙️ Audio analysis failed:', analyzeErr);
                }

                const file = new File([blob], `voice_${Date.now()}.webm`, { type: recorder.mimeType });
                try {
                    const result = await api.uploadFile(file);
                    console.log('🎙️ Uploaded. URL:', result.url, 'mimeType:', result.mimeType);
                    if (chatId) {
                        socketService.sendMessage({
                            chatId,
                            type: 'VOICE',
                            fileUrl: result.url,
                            fileName: result.fileName,
                            mimeType: result.mimeType || recorder.mimeType,
                            content: '🎤 Голосовое сообщение',
                            duration: recordingTimeRef.current,
                        });
                    }
                } catch (err) {
                    console.error('🎙️ Voice upload failed:', err);
                }
                stream.getTracks().forEach((t) => t.stop());
                setRecordingTime(0);
                recordingTimeRef.current = 0;
            };

            recorder.start(1000); // collect data every 1s for larger chunks
            setIsRecording(true);

            // Recording timer
            let sec = 0;
            recordingTimerRef.current = setInterval(() => {
                sec++;
                recordingTimeRef.current = sec;
                setRecordingTime(sec);
            }, 1000);
        } catch (err) {
            console.error('🎙️ Mic access denied:', err);
        }
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    const startVideoRecording = async () => {
        if (!chatId || isReadOnlyChannel || isVideoRecording) return;
        try {
            setVideoError('');
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            videoRecordingStreamRef.current = stream;
            if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;
            const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
                .find((type) => MediaRecorder.isTypeSupported(type));
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            videoRecorderRef.current = recorder;
            videoChunksRef.current = [];
            recorder.ondataavailable = (event) => event.data.size && videoChunksRef.current.push(event.data);
            recorder.onstop = async () => {
                try {
                    const blob = new Blob(videoChunksRef.current, { type: recorder.mimeType || 'video/webm' });
                    if (!blob.size) throw new Error('Видео получилось пустым');
                    const result = await api.uploadFile(new File([blob], `video_${Date.now()}.webm`, { type: blob.type }));
                    if (!socketService.isConnected()) throw new Error('Нет соединения с чатом. Повторите отправку');
                    await new Promise<void>((resolve, reject) => {
                        socketService.sendMessage({ chatId, type: 'VIDEO', fileUrl: result.url, fileName: result.fileName, mimeType: result.mimeType, content: '🎥 Видеосообщение' }, (response) => {
                            if (response?.error) reject(new Error(response.error));
                            else resolve();
                        });
                    });
                } catch (error: any) {
                    setVideoError(error.message || 'Не удалось отправить видеосообщение');
                } finally {
                    stream.getTracks().forEach((track) => track.stop());
                    videoRecordingStreamRef.current = null;
                    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null;
                    if (videoTimerRef.current) clearInterval(videoTimerRef.current);
                    setVideoRecordingTime(0);
                    setIsVideoPaused(false);
                }
            };
            recorder.start();
            setIsVideoRecording(true);
            setIsVideoPaused(false);
            setVideoRecordingTime(0);
            videoTimerRef.current = setInterval(() => {
                setVideoRecordingTime((time) => {
                    if (recorder.state !== 'recording') return time;
                    const nextTime = time + 1;
                    if (nextTime >= 60) {
                        recorder.stop();
                        setIsVideoRecording(false);
                    }
                    return nextTime;
                });
            }, 1000);
        } catch (error: any) {
            setVideoError(error.name === 'NotAllowedError'
                ? 'Разрешите доступ к камере и микрофону в браузере'
                : error.message || 'Не удалось начать видеозапись');
        }
    };

    const stopVideoRecording = () => {
        if (videoRecorderRef.current?.state === 'recording') videoRecorderRef.current.stop();
        if (videoRecorderRef.current?.state === 'paused') videoRecorderRef.current.stop();
        if (videoTimerRef.current) clearInterval(videoTimerRef.current);
        setIsVideoRecording(false);
    };

    const toggleVideoPause = () => {
        const recorder = videoRecorderRef.current;
        if (!recorder) return;
        if (recorder.state === 'recording') {
            recorder.pause();
            setIsVideoPaused(true);
        } else if (recorder.state === 'paused') {
            recorder.resume();
            setIsVideoPaused(false);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.ondataavailable = null;
            mediaRecorderRef.current.onstop = null;
            mediaRecorderRef.current.stream?.getTracks().forEach((t) => t.stop());
            try { mediaRecorderRef.current.stop(); } catch { }
        }
        setIsRecording(false);
        setRecordingTime(0);
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };

    // ── Search users ──
    useEffect(() => {
        if (searchQuery.length < 2) { setSearchResults([]); return; }
        const timer = setTimeout(async () => {
            try { setSearchResults(await api.searchUsers(searchQuery)); } catch { }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleCreatePrivateChat = async (userId: string) => {
        try {
            const chat = await api.createPrivateChat(userId);
            setShowNewChat(false);
            setSearchQuery('');
            socketService.joinChat(chat.id);
            setChats(await api.getChats());
            navigate(`/chat/${chat.id}`);
        } catch { }
    };

    const handleCreateGroup = async () => {
        if (!groupName.trim()) return;
        try {
            const chat = await api.createGroupChat(groupName, selectedMembers);
            setShowNewGroup(false);
            setGroupName('');
            setSelectedMembers([]);
            socketService.joinChat(chat.id);
            setChats(await api.getChats());
            navigate(`/chat/${chat.id}`);
        } catch { }
    };

    const handleCreateChannel = async () => {
        if (!channelName.trim() || (channelPublic && !channelUsername.trim())) return;
        try {
            const chat = await api.createChannel({
                name: channelName.trim(),
                username: channelPublic ? channelUsername.trim() : undefined,
                description: channelDescription.trim() || undefined,
                isPublic: channelPublic,
                memberIds: selectedMembers,
            });
            setShowNewChannel(false);
            setShowCreateMenu(false);
            setChannelName('');
            setChannelUsername('');
            setChannelDescription('');
            setSelectedMembers([]);
            socketService.joinChat(chat.id);
            setChats(await api.getChats());
            navigate(`/chat/${chat.id}`);
        } catch (err) {
            console.error('Channel creation failed:', err);
        }
    };

    const handleLogout = async () => {
        try { await api.logout(); } catch { }
        logout();
        navigate('/login');
    };

    const switchLang = (lng: string) => {
        i18n.changeLanguage(lng);
        localStorage.setItem('locale', lng);
        api.updateProfile({ locale: lng }).catch(() => { });
    };

    const handleProfileUpdate = (data: any) => {
        updateUser(data);
    };

    const handleProfileFieldChange = (field: 'displayName' | 'surname' | 'username', value: string) => {
        const nextValue = field === 'username' ? value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) : value.slice(0, 64);
        setProfileDraft((current) => ({ ...current, [field]: nextValue }));
    };

    const handleProfileSave = async () => {
        setProfileSaving(true);
        setProfileError('');
        try {
            const updated = await api.updateProfile(profileDraft);
            updateUser(updated);
        } catch (error: any) {
            setProfileError(error.message || 'Не удалось сохранить профиль');
        } finally {
            setProfileSaving(false);
        }
    };

    const handleProfileCancel = () => {
        if (!user) return;
        setProfileDraft({
            displayName: user.displayName || '',
            surname: user.surname || '',
            username: user.username || '',
            bio: user.bio || '',
        });
        setProfileError('');
    };

    const handleSettingsAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const result = await api.uploadAvatar(file);
            updateUser({ avatarUrl: result.avatarUrl });
        } catch (error) {
            console.error('Avatar upload failed:', error);
        } finally {
            event.target.value = '';
        }
    };

    const chatMessages = messages[chatId || ''] || [];
    const chatTyping = typingUsers[chatId || ''] || [];
    let lastDate = '';

    // ── Folders config ──
    const folders = [
        { id: 'all', label: 'Все', icon: '💬' },
        { id: 'private', label: 'Личные', icon: '👤' },
        { id: 'groups', label: 'Группы', icon: '👥' },
        { id: 'channels', label: 'Каналы', icon: '📡' },
    ];

    return (
        <div className={`app-layout ${chatId ? 'chat-open' : ''}`}>
            <aside className="sidebar-rail" aria-label="Разделы UniChat">
                <button className={`rail-item ${activeFolder === 'all' && !showContacts && !showCalls ? 'active' : ''}`} onClick={() => { setActiveFolder('all'); navigate('/chat'); }}>
                    <span className="rail-icon">▰</span><span>Чаты</span>
                </button>
                <button className={`rail-item ${activeFolder === 'groups' ? 'active' : ''}`} onClick={() => { setActiveFolder('groups'); navigate('/chat'); }}>
                    <span className="rail-icon rail-badge">▰<b>7</b></span><span>Группы</span>
                </button>
                <button className={`rail-item ${activeFolder === 'channels' ? 'active' : ''}`} onClick={() => { setActiveFolder('channels'); navigate('/chat'); }}>
                    <span className="rail-icon rail-badge">▰<b>7</b></span><span>Каналы</span>
                </button>
                <div className="rail-divider" />
                <button className={`rail-item ${showContacts ? 'active' : ''}`} onClick={openContacts}>
                    <span className="rail-icon">♟</span><span>Контакты</span>
                </button>
                <button className={`rail-item ${showCalls ? 'active' : ''}`} onClick={openCalls}>
                    <span className="rail-icon">◖</span><span>Звонки</span>
                </button>
                <button className={`rail-item rail-settings ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings((value) => !value)}>
                    <span className="rail-icon">⚙</span><span>Настройки</span>
                </button>
            </aside>
            {/* ═══ SIDEBAR ═══ */}
            <div className="sidebar">
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <div className="sidebar-logo-icon">💬</div>
                        <h1>UniChat</h1>
                    </div>
                    <div className="sidebar-actions">
                        <button className="btn-icon" onClick={() => setShowCreateMenu((value) => !value)} title="Создать чат, группу или канал">✏️</button>
                    </div>
                </div>

                {showCreateMenu && <div className="create-menu glass-panel">
                    <button onClick={() => { setShowNewChat(true); setShowCreateMenu(false); setSearchQuery(''); }}>💬 <span>Новый чат</span></button>
                    <button onClick={() => { setShowNewGroup(true); setShowCreateMenu(false); setSearchQuery(''); setSelectedMembers([]); }}>👥 <span>Новая группа</span></button>
                    <button onClick={() => { setShowNewChannel(true); setShowCreateMenu(false); setSearchQuery(''); setSelectedMembers([]); }}>📡 <span>Новый канал</span></button>
                </div>}

                {showSettings && (
                    <div className={`settings-panel settings-window settings-shell ${theme === 'dark' ? 'settings-shell-dark' : 'settings-shell-light'}`}>
                        <aside className="settings-navigation-rail" aria-label="Основная навигация">
                            <button className="rail-item" type="button" onClick={() => { setShowSettings(false); setActiveFolder('all'); navigate('/chat'); }}><span className="rail-icon">▰</span><span>Чаты</span></button>
                            <button className="rail-item" type="button" onClick={() => { setShowSettings(false); setActiveFolder('groups'); navigate('/chat'); }}><span className="rail-icon">▰</span><span>Группы</span></button>
                            <button className="rail-item" type="button" onClick={() => { setShowSettings(false); setActiveFolder('channels'); navigate('/chat'); }}><span className="rail-icon">▰</span><span>Каналы</span></button>
                            <div className="rail-divider" />
                            <button className="rail-item" type="button" onClick={() => { setShowSettings(false); openContacts(); }}><span className="rail-icon">♟</span><span>Контакты</span></button>
                            <button className="rail-item" type="button" onClick={() => { setShowSettings(false); openCalls(); }}><span className="rail-icon">◖</span><span>Звонки</span></button>
                            <button className="rail-item active rail-settings" type="button"><span className="rail-icon">⚙</span><span>Настройки</span></button>
                        </aside>
                        <aside className="settings-sidebar">
                            <div className="settings-sidebar-header">
                                <h2 className="settings-title">Настройки</h2>
                                <button className="settings-close-btn" type="button" onClick={() => setShowSettings(false)} aria-label="Закрыть настройки">×</button>
                            </div>

                            <button className={`settings-menu-item ${settingsTab === 'profile' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('profile')}>
                                <span className="settings-avatar-wrap">
                                    <span className="settings-avatar" aria-hidden="true">
                                        {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : (user?.username ? user.username.slice(0, 1).toUpperCase() : 'И'))}
                                    </span>
                                </span>
                                <span className="settings-item-copy">
                                    <span className="settings-item-name">{user?.displayName || 'Имя не указано'}</span>
                                    <span className="settings-item-subtitle">@{user?.username || 'username'}</span>
                                </span>
                                <span className="settings-item-arrow">›</span>
                            </button>

                            {[
                                { id: 'invite', icon: '↗', label: 'Пригласить друзей' },
                                { id: 'folders', icon: '▱', label: 'Папки' },
                                { id: 'security', icon: '♙', label: 'Безопасность' },
                                { id: 'devices', icon: '▣', label: 'Устройства' },
                                { id: 'notifications', icon: '♧', label: 'Уведомления' },
                                { id: 'theme', icon: '✣', label: 'Оформление' },
                                { id: 'language', icon: '◎', label: 'Язык приложения' },
                            ].map((item) => (
                                <button key={item.id} className={`settings-menu-item ${settingsTab === item.id ? 'active' : ''}`} type="button" onClick={() => setSettingsTab(item.id as any)}>
                                    <span className="settings-menu-icon" aria-hidden="true">{item.icon}</span>
                                    <span className="settings-menu-label">{item.label}</span>
                                    <span className="settings-item-arrow">›</span>
                                </button>
                            ))}
                            <button className="settings-menu-item settings-premium-item" type="button" onClick={() => setSettingsTab('profile')}>
                                <span className="settings-premium-icon" aria-hidden="true">★</span>
                                <span className="settings-menu-label">UniChat Premium</span>
                                <span className="settings-item-arrow">›</span>
                            </button>
                        </aside>

                        <div className="settings-main-panel">
                            {settingsTab === 'profile' && (
                                <>
                                    <h3 className="settings-main-title">Редактировать профиль</h3>
                                    <div className="settings-form-card">
                                        <div className="settings-avatar-editor">
                                            <button className="settings-avatar-large" type="button" aria-label="Выбрать аватар" onClick={() => settingsAvatarInputRef.current?.click()}>
                                                {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : (user?.username ? user.username.slice(0, 1).toUpperCase() : 'И'))}
                                                <span className="settings-avatar-upload-hint">📷</span>
                                            </button>
                                            <input ref={settingsAvatarInputRef} className="settings-hidden-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleSettingsAvatarChange} />
                                        </div>

                                        <div className="settings-field-row">
                                            <label className="settings-field-label">Имя</label>
                                            <div className="settings-input-wrap">
                                                <input className="settings-input" value={profileDraft.displayName} onChange={(event) => handleProfileFieldChange('displayName', event.target.value)} placeholder="Введите имя" />
                                                <span className="settings-counter">{profileDraft.displayName.length}/64</span>
                                            </div>
                                        </div>

                                        <div className="settings-field-row">
                                            <label className="settings-field-label">Фамилия</label>
                                            <div className="settings-input-wrap">
                                                <input className="settings-input" value={profileDraft.surname} onChange={(event) => handleProfileFieldChange('surname', event.target.value)} placeholder="Введите фамилию" />
                                                <span className="settings-counter">{profileDraft.surname.length}/64</span>
                                            </div>
                                        </div>

                                        <div className="settings-field-row">
                                            <label className="settings-field-label">@username</label>
                                            <div className="settings-input-wrap">
                                                <input className="settings-input" value={profileDraft.username} onChange={(event) => handleProfileFieldChange('username', event.target.value)} placeholder="username" />
                                                <span className="settings-counter">{profileDraft.username.length}/32</span>
                                            </div>
                                        </div>

                                        <div className="settings-field-row">
                                            <label className="settings-field-label">Телефон</label>
                                            <div className="settings-input-wrap">
                                                <input className="settings-input" value={user?.phone || 'Номер не указан'} readOnly />
                                            </div>
                                        </div>

                                        <div className="settings-field-row">
                                            <label className="settings-field-label">О себе</label>
                                            <div className="settings-input-wrap settings-input-wrap-textarea">
                                                <textarea className="settings-input settings-textarea" value={profileDraft.bio} onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value.slice(0, 500) }))} placeholder="Расскажите о себе" rows={3} />
                                                <span className="settings-counter">{profileDraft.bio.length}/500</span>
                                            </div>
                                        </div>

                                        {profileError && <div className="login-error">{profileError}</div>}
                                        <div className="settings-actions-row">
                                            {JSON.stringify(profileDraft) !== JSON.stringify({ displayName: user?.displayName || '', surname: user?.surname || '', username: user?.username || '', bio: user?.bio || '' }) && <>
                                                <button className="settings-save-btn" type="button" onClick={handleProfileSave} disabled={profileSaving}>{profileSaving ? 'Сохранение...' : 'Сохранить'}</button>
                                                <button className="settings-cancel-btn" type="button" onClick={handleProfileCancel} disabled={profileSaving}>Отмена</button>
                                            </>}
                                            <button className="settings-logout-btn" type="button" onClick={handleLogout}>Выйти из профиля</button>
                                        </div>
                                    </div>
                                </>
                            )}

                            {settingsTab === 'theme' && (
                                <>
                                    <h3 className="settings-main-title">Оформление</h3>
                                    <div className="settings-option-grid">
                                        <button className={`settings-option-card ${theme === 'dark' ? 'selected' : ''}`} onClick={() => setTheme('dark')} type="button">
                                            <span className="settings-option-icon">🌙</span>
                                            <span className="settings-option-title">Тёмная</span>
                                            <span className="settings-option-subtitle">Ночной режим</span>
                                        </button>
                                        <button className={`settings-option-card ${theme === 'light' ? 'selected' : ''}`} onClick={() => setTheme('light')} type="button">
                                            <span className="settings-option-icon">☀️</span>
                                            <span className="settings-option-title">Светлая</span>
                                            <span className="settings-option-subtitle">Легкий интерфейс</span>
                                        </button>
                                    </div>
                                </>
                            )}

                            {settingsTab === 'language' && (
                                <>
                                    <h3 className="settings-main-title">Язык приложения</h3>
                                    <div className="settings-option-grid single-row">
                                        <button className={`settings-option-card ${i18n.language === 'ru' ? 'selected' : ''}`} onClick={() => switchLang('ru')} type="button">
                                            <span className="settings-option-icon">🇷🇺</span>
                                            <span className="settings-option-title">Русский</span>
                                            <span className="settings-option-subtitle">RU</span>
                                        </button>
                                        <button className={`settings-option-card ${i18n.language === 'en' ? 'selected' : ''}`} onClick={() => switchLang('en')} type="button">
                                            <span className="settings-option-icon">🇬🇧</span>
                                            <span className="settings-option-title">English</span>
                                            <span className="settings-option-subtitle">EN</span>
                                        </button>
                                    </div>
                                </>
                            )}

                            {settingsTab === 'notifications' && (
                                <>
                                    <h3 className="settings-main-title">Уведомления</h3>
                                    <div className="settings-toggle-card">
                                        <div>
                                            <div className="settings-option-title">Push-уведомления</div>
                                            <div className="settings-option-subtitle">{notificationsEnabled ? 'Включены' : 'Выключены'}</div>
                                        </div>
                                        <button className={`settings-toggle ${notificationsEnabled ? 'on' : ''}`} type="button" onClick={toggleNotifications}>
                                            <span className="settings-toggle-knob" />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Folder tabs */}
                <div className="folder-tabs">
                    {folders.map((f) => (
                        <button
                            key={f.id}
                            className={`folder-tab ${activeFolder === f.id ? 'active' : ''}`}
                            onClick={() => setActiveFolder(f.id)}
                        >
                            <span className="folder-tab-icon">{f.icon}</span>
                            <span className="folder-tab-label">{f.label}</span>
                        </button>
                    ))}
                </div>

                <div className="sidebar-search">
                    <div className="search-wrapper">
                        <span className="search-icon">🔍</span>
                        <input className="input" placeholder={t('common.search') + '...'} />
                    </div>
                </div>

                <div className="chat-list">
                    {filteredChats.length === 0 && (
                        <div className="empty-state" style={{ padding: '60px 24px' }}>
                            <div className="empty-state-icon">💬</div>
                            <div className="empty-state-title">{t('chat.noChats').split('.')[0]}</div>
                            <div className="empty-state-subtitle">{t('chat.noChats').split('.').slice(1).join('.').trim()}</div>
                        </div>
                    )}
                    {filteredChats.map((chat) => {
                        const name = getChatName(chat);
                        const lastMsg = chat.messages?.[0];
                        const otherUserId = getOtherUserId(chat);
                        const isOnline = otherUserId ? onlineUsers.has(otherUserId) : false;
                        const avatarId = getChatAvatarId(chat);

                        return (
                            <div key={chat.id} className={`chat-item ${chat.id === chatId ? 'active' : ''}`} onClick={() => navigate(`/chat/${chat.id}`)}>
                                <div className={`avatar ${getAvatarClass(avatarId)} ${isOnline ? 'avatar-online' : ''}`}>
                                    {getChatAvatar(chat) ? <img src={getChatAvatar(chat)!} alt="" /> : getInitials(name)}
                                </div>
                                <div className="chat-item-content">
                                    <div className="chat-item-header">
                                        <span className="chat-item-name">
                                            {chat.type === 'GROUP' && <span className="chat-item-type">👥 </span>}
                                            {chat.type === 'CHANNEL' && <span className="chat-item-type">📡 </span>}
                                            {name}
                                            {chat.type === 'PRIVATE' && chat.members?.find((member: any) => member.userId !== user?.id)?.user?.isVerified && <span className="verified-badge">✓</span>}
                                        </span>
                                        {lastMsg && <span className="chat-item-time">{formatTime(lastMsg.createdAt)}</span>}
                                    </div>
                                    <div className={`chat-item-preview ${chat.name === 'Избранное' ? 'favorites-description' : ''}`}>{lastMsg?.content || (chat.name === 'Избранное' ? 'Сохраняйте сообщения, файлы и ссылки' : '...')}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ═══ CHAT AREA ═══ */}
            <div className="chat-area">
                {!chatId || !activeChat ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">💬</div>
                        <div className="empty-state-title">UniChat</div>
                        <div className="empty-state-subtitle">{t('chat.noChats')}</div>
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="chat-header">
                                                        <button className="btn-icon chat-header-back" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/chat'); }} title="Назад">←</button>
                            <div className={`avatar ${getAvatarClass(getChatAvatarId(activeChat))} ${activeChat.name === 'Избранное' ? '' : (() => { const uid = getOtherUserId(activeChat); return uid && onlineUsers.has(uid) ? 'avatar-online' : ''; })()}`}>
                                {getChatAvatar(activeChat) ? <img src={getChatAvatar(activeChat)!} alt="" /> : getInitials(getChatName(activeChat))}
                            </div>
                            <div className="chat-header-info">
                                <div className="chat-header-name">{getChatName(activeChat)}</div>
                                <div className={`chat-header-status ${activeChat.name === 'Избранное' ? 'favorites-description' : ''}`}>
                                    {activeChat.name === 'Избранное'
                                        ? 'Сохраняйте сообщения, файлы и ссылки'
                                        : activeChat.type === 'CHANNEL'
                                        ? `${activeChat.members.length} подписчиков`
                                        : activeChat.type === 'GROUP'
                                        ? `${activeChat.members.length} ${t('chat.members')}`
                                        : (() => { const uid = getOtherUserId(activeChat); return uid && onlineUsers.has(uid) ? t('chat.online') : t('chat.offline'); })()}
                                </div>
                            </div>
                            <div className="chat-header-actions">
                                {!isChannel && <button className="btn-icon" onClick={() => startCall('audio')} title="Аудиозвонок">☎</button>}
                                {!isChannel && <button className="btn-icon" onClick={() => startCall('video')} title="Видеозвонок">▣</button>}
                                <button className="btn-icon" title="Search">🔍</button>
                                {activeChat.name !== 'Избранное' && <button className="btn-icon" onClick={() => setShowChatMenu(true)} title="Действия чата">⋯</button>}
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="messages-container">
                            {chatMessages.length === 0 && (
                                <div className="empty-state">
                                    <div className="empty-state-icon">👋</div>
                                    <div className="empty-state-title">{t('chat.noMessages').split('.')[0]}</div>
                                    <div className="empty-state-subtitle">{t('chat.noMessages').split('.').slice(1).join('.').trim()}</div>
                                </div>
                            )}
                            {chatMessages.map((msg) => {
                                const msgDate = formatDate(msg.createdAt);
                                let showDateSep = false;
                                if (msgDate !== lastDate) { lastDate = msgDate; showDateSep = true; }
                                const isOwn = msg.senderId === user?.id;
                                const isDeleted = !!msg.deletedAt;

                                return (
                                    <div key={msg.id}>
                                        {showDateSep && <div className="date-separator"><span>{msgDate}</span></div>}
                                        <div className={`message-wrapper ${isOwn ? 'own' : ''}`}>
                                            <div className="message">
                                                {!isOwn && activeChat.type === 'GROUP' && (
                                                    <div className="message-sender">{msg.sender?.displayName || msg.sender?.username || 'User'} {msg.sender?.isVerified && <span className="verified-badge" title="Подтверждённый аккаунт">✓</span>}</div>
                                                )}

                                                {msg.replyTo && (
                                                    <div className="message-reply">
                                                        <div className="message-reply-name">{msg.replyTo.sender?.displayName || 'User'}</div>
                                                        <div className="message-reply-content">{msg.replyTo.content}</div>
                                                    </div>
                                                )}

                                                {isDeleted ? (
                                                    <div className="message-deleted">🚫 {t('chat.deleted')}</div>
                                                ) : (
                                                    <>
                                                        {msg.type === 'IMAGE' && msg.fileUrl && (
                                                            <img className="message-image" src={msg.fileUrl} alt="" loading="lazy" />
                                                        )}

                                                        {msg.type === 'FILE' && msg.fileUrl && (
                                                            <a className="message-file" href={msg.fileUrl} target="_blank" rel="noopener">
                                                                <div className="message-file-icon">📄</div>
                                                                <div className="message-file-info">
                                                                    <div className="message-file-name">{msg.fileName}</div>
                                                                    <div className="message-file-size">{formatFileSize(msg.fileSize)}</div>
                                                                </div>
                                                            </a>
                                                        )}

                                                        {msg.type === 'VOICE' && msg.fileUrl && (
                                                            <VoicePlayer src={msg.fileUrl} />
                                                        )}

                                                        {msg.type === 'VIDEO' && msg.fileUrl && (
                                                            <VideoMessage src={msg.fileUrl} />
                                                        )}

                                                        {msg.type === 'TEXT' && <div className="message-content">{msg.content}</div>}
                                                    </>
                                                )}

                                                <div className="message-meta">
                                                    {msg.editedAt && <span className="message-edited">{t('chat.edited')}</span>}
                                                    <span className="message-time">{formatTime(msg.createdAt)}</span>
                                                </div>

                                                {!isDeleted && (
                                                    <div className="message-actions">
                                                        <button className="message-action-btn" onClick={() => setReplyTo(msg)} title={t('chat.reply')}>↩</button>
                                                        {isOwn && (
                                                            <>
                                                                <button className="message-action-btn" onClick={() => { const c = prompt('Edit:', msg.content || ''); if (c !== null) socketService.editMessage(msg.id, c); }} title={t('chat.edit')}>✎</button>
                                                                <button className="message-action-btn" onClick={() => { if (confirm('Delete?')) socketService.deleteMessage(msg.id); }} title={t('chat.delete')}>✕</button>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Typing indicator */}
                        {!isChannel && <div className="typing-indicator">
                            {chatTyping.length > 0 && (
                                <>
                                    <div className="typing-dots">
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                        <div className="typing-dot" />
                                    </div>
                                    <span className="typing-user-list">{chatTyping.map((typingUserId) => { const member = activeChat.members?.find((item: any) => item.userId === typingUserId || item.user?.id === typingUserId); const typingUser = member?.user || member; return <span className="typing-user" key={typingUserId}>{typingUser?.avatarUrl ? <img src={typingUser.avatarUrl} alt="" /> : <span className="typing-avatar-fallback">{(typingUser?.displayName || typingUser?.username || '?').slice(0, 1).toUpperCase()}</span>}<strong>{typingUser?.displayName || typingUser?.username || 'Пользователь'}</strong></span>; })}</span>
                                </>
                            )}
                        </div>}

                        {/* Input area */}
                        <div className="message-input-area">
                            {isReadOnlyChannel ? (
                                <button className="btn btn-secondary" onClick={toggleChatMute} style={{ width: '100%' }}>
                                    {isChatMuted ? '🔊 Включить звук' : '🔇 Выключить звук'}
                                </button>
                            ) : (
                            <>
                            {replyTo && (
                                <div className="reply-bar">
                                    <div className="reply-bar-content">
                                        <div className="reply-bar-name">{replyTo.sender?.displayName || 'User'}</div>
                                        <div className="reply-bar-text">{replyTo.content}</div>
                                    </div>
                                    <button className="btn-icon" onClick={() => setReplyTo(null)} style={{ width: 28, height: 28, fontSize: 14 }}>✕</button>
                                </div>
                            )}

                            {isRecording ? (
                                <div className="recording-bar">
                                    <div className="recording-indicator">
                                        <div className="recording-dot" />
                                        <span className="recording-time">{formatDuration(recordingTime)}</span>
                                    </div>
                                    <div className="recording-wave">
                                        {Array.from({ length: 20 }, (_, i) => (
                                            <div
                                                key={i}
                                                className="recording-wave-bar"
                                                style={{
                                                    animationDelay: `${i * 0.05}s`,
                                                    height: `${8 + Math.random() * 20}px`,
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <button className="btn-icon recording-cancel" onClick={cancelRecording} title="Отмена">✕</button>
                                    <button className="btn-icon recording-stop" onClick={stopRecording} title="Отправить">➤</button>
                                </div>
                            ) : (
                                isVideoRecording ? <div className="video-recording-bar"><video ref={videoPreviewRef} autoPlay muted playsInline /><span className="video-recording-time">{videoRecordingTime}/60 сек</span><button className="btn-icon" onClick={toggleVideoPause} title={isVideoPaused ? 'Продолжить запись' : 'Пауза'}>{isVideoPaused ? '▶' : 'Ⅱ'}</button><button className="btn-icon recording-stop" onClick={stopVideoRecording} title="Отправить видеосообщение">➤</button></div> :
                                <div className="message-input-row">
                                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                                    <button className="btn-icon" onClick={() => fileInputRef.current?.click()} title={t('chat.file')} disabled={isReadOnlyChannel}>📎</button>
                                    <button className="btn-icon" onClick={startRecording} title={t('chat.voice')} disabled={isReadOnlyChannel}>🎤</button>
                                    <button className="btn-icon video-record-button" onClick={startVideoRecording} title="Записать видеосообщение" disabled={isReadOnlyChannel}>▣</button>

                                    <textarea
                                        className="input"
                                        placeholder={t('chat.typeMessage')}
                                        value={messageText}
                                        disabled={isReadOnlyChannel}
                                        onChange={(e) => { setMessageText(e.target.value); handleTyping(); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                                        rows={1}
                                    />

                                    <button className="send-btn" onClick={handleSendMessage} disabled={!messageText.trim() || isReadOnlyChannel}>➤</button>
                                </div>
                            )}
                            {videoError && <div className="form-hint video-error">{videoError}</div>}
                            </>
                            )}
                        </div>
                        {incomingCall && <div className="incoming-call-overlay"><div className="call-title">Входящий {incomingCall.callType === 'video' ? 'видеозвонок' : 'аудиозвонок'}</div><div className="incoming-call-actions"><button className="btn btn-primary" onClick={answerIncomingCall}>Ответить</button><button className="btn btn-danger" onClick={rejectIncomingCall}>Сбросить</button></div></div>}
                        {callType && <div className="call-overlay"><div className="call-title">{callType === 'video' ? 'Видеозвонок' : 'Аудиозвонок'} активен</div><audio ref={remoteAudioRef} autoPlay /><video ref={remoteVideoRef} className={`call-remote-video ${callType === 'audio' ? 'call-audio-only' : ''}`} autoPlay playsInline /><video ref={localVideoRef} className={`call-local-video ${callType === 'audio' ? 'call-audio-only' : ''}`} autoPlay muted playsInline /><div className="call-controls"><button className="btn btn-secondary" onClick={toggleCallMute}>{isCallMuted ? 'Включить микрофон' : 'Выключить микрофон'}</button><button className="btn btn-danger" onClick={endCall}>Завершить</button></div></div>}
                    </>
                )}
            </div>

            {showContacts && <div className="modal-overlay" onClick={() => setShowContacts(false)}><div className="bottom-sheet glass-panel" onClick={(event) => event.stopPropagation()}>
                <div className="bottom-sheet-header"><div><span className="eyebrow">COMMUNITY</span><h3>Контакты</h3></div><button className="btn-icon" onClick={() => setShowContacts(false)}>✕</button></div>
                <p className="form-hint">Выберите контакты из телефонной книги. Показываются только зарегистрированные в UniChat.</p>
                <div className="contact-list">{contacts.length === 0 ? <div className="empty-panel">Пока нет зарегистрированных контактов</div> : contacts.map((contact) => <button className="contact-row" key={contact.id} onClick={async () => { const chat = await api.createPrivateChat(contact.id); setChats(await api.getChats()); setShowContacts(false); navigate(`/chat/${chat.id}`); }}><div className="avatar avatar-sm avatar-gradient-3">{(contact.displayName || contact.username || '?').slice(0, 1).toUpperCase()}</div><span><strong>{contact.displayName || contact.username || 'Без имени'} {contact.isVerified && <span className="verified-badge">✓</span>}</strong><small>@{contact.username || 'без username'}</small></span><b>→</b></button>)}</div>
            </div></div>}

            {showChatMenu && chatId && <div className="modal-overlay" onClick={() => setShowChatMenu(false)}>
                <div className="modal chat-actions-modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header"><div><span className="eyebrow">{isChannel ? 'CHANNEL ACTIONS' : 'CHAT ACTIONS'}</span><h3>{isChannel ? 'Действия канала' : 'Действия чата'}</h3></div><button className="btn-icon" onClick={() => setShowChatMenu(false)}>✕</button></div>
                    {!isChannel && activeChat?.name !== 'Избранное' && <button className="chat-action-row" onClick={toggleChatMute}>🔇 <span>{isChatMuted ? 'Включить звук' : 'Выключить звук'}</span></button>}
                    {['GROUP', 'CHANNEL'].includes(activeChat?.type || '') && ['OWNER', 'ADMIN'].includes(currentMember?.role) && <button className="chat-action-row" onClick={() => { setShowChatMenu(false); setShowAddMember(true); }}>＋ <span>Добавить пользователя</span></button>}
                    {activeChat?.name !== 'Избранное' && <button className="chat-action-row" onClick={leaveCurrentChat}>↩ <span>{activeChat?.type === 'CHANNEL' ? 'Выйти из канала' : 'Выйти из чата'}</span></button>}
                    {activeChat?.name !== 'Избранное' && canDeleteActiveChat && <button className="chat-action-row danger-action" onClick={deleteCurrentChat}>⌫ <span>{activeChat?.type === 'CHANNEL' ? 'Удалить канал' : 'Удалить чат'}</span></button>}
                </div>
            </div>}

            {showAddMember && <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
                <div className="modal" onClick={(event) => event.stopPropagation()}>
                    <div className="modal-header"><div><span className="eyebrow">MEMBERS</span><h3>Добавить пользователя</h3></div><button className="btn-icon" onClick={() => setShowAddMember(false)}>✕</button></div>
                    <input className="input" placeholder={t('chat.searchUsers')} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus />
                    <div className="search-results">{searchResults.map((candidate) => <button className="search-result-item" key={candidate.id} onClick={() => addMemberToChat(candidate.id)}><div className={`avatar avatar-sm ${getAvatarClass(candidate.id)}`}>{candidate.avatarUrl ? <img src={candidate.avatarUrl} alt="" /> : getInitials(candidate.displayName || candidate.username)}</div><div className="search-result-info"><div className="search-result-name">{candidate.displayName || candidate.username || candidate.id}</div><div className="search-result-username">@{candidate.username || 'без username'}</div></div><span>＋</span></button>)}</div>
                </div>
            </div>}

            {showCalls && <div className="modal-overlay" onClick={() => setShowCalls(false)}><div className="bottom-sheet glass-panel" onClick={(event) => event.stopPropagation()}>
                <div className="bottom-sheet-header"><div><span className="eyebrow">HISTORY</span><h3>Звонки</h3></div><button className="btn-icon" onClick={() => setShowCalls(false)}>✕</button></div>
                <div className="contact-list">{calls.length === 0 ? <div className="empty-panel">История звонков пуста</div> : calls.map((call) => { const other = call.callerId === user?.id ? call.callee : call.caller; return <div className="call-row" key={call.id}><span className="call-kind">{call.type === 'VIDEO' ? '▣' : '☎'}</span><span><strong>{other?.displayName || other?.username || 'Пользователь'}</strong><small>{call.type === 'VIDEO' ? 'Видеозвонок' : 'Аудиозвонок'} · {new Date(call.createdAt).toLocaleString()}</small></span><span className="call-status">{call.status === 'COMPLETED' ? 'Завершён' : call.status}</span></div>; })}</div>
            </div></div>}

            {/* ═══ Profile Modal ═══ */}
            {showProfile && user && (
                <ProfilePanel
                    user={user}
                    onClose={() => setShowProfile(false)}
                    onSaved={() => {
                        setShowProfile(false);
                        navigate('/chat');
                    }}
                    onUpdate={(data) => {
                        handleProfileUpdate(data);
                    }}
                />
            )}

            {/* ═══ NEW CHAT MODAL ═══ */}
            {showNewChat && (
                <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>✏️ {t('chat.newChat')}</h3>
                        <div className="input-group">
                            <input className="input" placeholder={t('chat.searchUsers')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                        </div>
                        <div className="search-results">
                            {searchResults.map((u) => (
                                <div key={u.id} className="search-result-item" onClick={() => handleCreatePrivateChat(u.id)}>
                                    <div className={`avatar avatar-sm ${getAvatarClass(u.id)}`}>
                                        {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : getInitials(u.displayName || u.username)}
                                    </div>
                                    <div className="search-result-info">
                                        <div className="search-result-name">{u.displayName || u.username || u.id} {u.isVerified && <span className="verified-badge">✓</span>}</div>
                                        {u.username && <div className="search-result-username">@{u.username}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowNewChat(false)}>{t('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ NEW GROUP MODAL ═══ */}
            {showNewGroup && (
                <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>👥 {t('chat.newGroup')}</h3>
                        <div className="input-group" style={{ marginBottom: 12 }}>
                            <label className="input-label">{t('chat.groupName')}</label>
                            <input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} autoFocus />
                        </div>
                        <div className="input-group">
                            <label className="input-label">{t('chat.selectMembers')} <span className="optional-label">(необязательно)</span></label>
                            <input className="input" placeholder={t('chat.searchUsers')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                        <div className="search-results">
                            {searchResults.map((u) => {
                                const isSelected = selectedMembers.includes(u.id);
                                return (
                                    <div key={u.id} className={`search-result-item ${isSelected ? 'selected' : ''}`} onClick={() => {
                                        setSelectedMembers((p) => isSelected ? p.filter((id) => id !== u.id) : [...p, u.id]);
                                    }}>
                                        <div className={`avatar avatar-sm ${getAvatarClass(u.id)}`}>
                                            {u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : getInitials(u.displayName || u.username)}
                                        </div>
                                        <div className="search-result-info">
                                            <div className="search-result-name">{u.displayName || u.username || u.id}</div>
                                        </div>
                                        {isSelected && <span className="search-result-check">✓</span>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowNewGroup(false)}>{t('common.cancel')}</button>
                            <button className="btn btn-primary" onClick={handleCreateGroup} disabled={!groupName.trim()}>
                                {t('chat.create')} ({selectedMembers.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showNewChannel && (
                <div className="modal-overlay" onClick={() => setShowNewChannel(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>📡 Новый канал</h3>
                        <div className="input-group"><label className="input-label">Название</label><input className="input" value={channelName} onChange={(e) => setChannelName(e.target.value)} autoFocus /></div>
                        <div className="input-group"><label className="input-label">Описание</label><input className="input" value={channelDescription} onChange={(e) => setChannelDescription(e.target.value)} placeholder="О чём этот канал" /></div>
                        <div className="channel-visibility-picker" role="group" aria-label="Вид канала">
                            <button type="button" className={`channel-visibility-option ${channelPublic ? 'selected' : ''}`} onClick={() => setChannelPublic(true)}>
                                <span className="channel-visibility-icon">◉</span><span><strong>Публичный</strong><small>Виден всем пользователям</small></span>
                            </button>
                            <button type="button" className={`channel-visibility-option ${!channelPublic ? 'selected' : ''}`} onClick={() => setChannelPublic(false)}>
                                <span className="channel-visibility-icon">◌</span><span><strong>Частный</strong><small>Только по приглашению</small></span>
                            </button>
                        </div>
                        {channelPublic && <div className="input-group"><label className="input-label">Публичная ссылка</label><input className="input" value={channelUsername} onChange={(e) => setChannelUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} placeholder="my_channel" /></div>}
                        <div className="input-group">
                            <label className="input-label">Добавить пользователей <span className="optional-label">(необязательно)</span></label>
                            <input className="input" placeholder={t('chat.searchUsers')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                        <div className="search-results">
                            {searchResults.map((u) => {
                                const isSelected = selectedMembers.includes(u.id);
                                return <div key={u.id} className={`search-result-item ${isSelected ? 'selected' : ''}`} onClick={() => setSelectedMembers((current) => isSelected ? current.filter((id) => id !== u.id) : [...current, u.id])}>
                                    <div className={`avatar avatar-sm ${getAvatarClass(u.id)}`}>{u.avatarUrl ? <img src={u.avatarUrl} alt="" /> : getInitials(u.displayName || u.username)}</div>
                                    <div className="search-result-info"><div className="search-result-name">{u.displayName || u.username || u.id}</div></div>
                                                                        <div className="search-result-info"><div className="search-result-name">{u.displayName || u.username || u.id} {u.isVerified && <span className="verified-badge">✓</span>}</div></div>
                                                    <div className="contact-list">{calls.length === 0 ? <div className="empty-panel">История звонков пуста</div> : calls.map((call) => { const other = call.callerId === user?.id ? call.callee : call.caller; return <div className="call-row" key={call.id}><span className="call-kind">{call.type === 'VIDEO' ? '▣' : '☎'}</span><span><strong>{other?.displayName || other?.username || 'Пользователь'} {other?.isVerified && <span className="verified-badge">✓</span>}</strong><small>{call.type === 'VIDEO' ? 'Видеозвонок' : 'Аудиозвонок'} · {new Date(call.createdAt).toLocaleString()}</small></span><span className="call-status">{call.status === 'COMPLETED' ? 'Завершён' : call.status}</span></div>; })}</div>
                                    {isSelected && <span className="search-result-check">✓</span>}
                                </div>;
                            })}
                        </div>
                        <p className="form-hint">Писать в канале могут только владелец и администраторы.</p>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowNewChannel(false)}>{t('common.cancel')}</button><button className="btn btn-primary" onClick={handleCreateChannel} disabled={!channelName.trim() || (channelPublic && !channelUsername.trim())}>Создать канал</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
