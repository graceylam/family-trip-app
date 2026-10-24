"use client";

import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import ZoraLoader from "./ZoraLoader";
import {
  attachLegacyViennaTrip,
  createAccountTrip,
  createFamilyAccount,
  firebaseConfigured,
  firebaseErrorMessage,
  joinTripWithCode,
  joinTripWithInvite,
  observeAccountTrips,
  observeFamilyAccount,
  readTripInviteForAdmin,
  resetFamilyPassword,
  rotateTripInvite,
  signInToFamilyAccount,
  signOutOfFamilyAccount,
  updateFamilyProfile,
  type AccountTrip,
  type FamilyAccount,
  type TripInvite,
} from "../lib/firebaseAccounts";

type AccountPortalProps = {
  renderTrip: (account: FamilyAccount, trip: AccountTrip, onBack: () => void) => ReactNode;
};

type AccountMode = "sign-in" | "create";
const legacyViennaTripId = "vienna-2026-family-trip";
const tripShelfCacheVersion = 1;

function tripShelfCacheKey(uid: string): string {
  return `family-trip-shelf-v${tripShelfCacheVersion}:${uid}`;
}

function readTripShelf(uid: string): AccountTrip[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(tripShelfCacheKey(uid)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((trip): trip is AccountTrip => Boolean(
      trip && typeof trip.id === "string" && typeof trip.name === "string" && (trip.role === "admin" || trip.role === "contributor"),
    ));
  } catch { return []; }
}

function writeTripShelf(uid: string, trips: AccountTrip[]): void {
  try { window.localStorage.setItem(tripShelfCacheKey(uid), JSON.stringify(trips)); }
  catch { /* The live Firebase shelf still works if device storage is unavailable. */ }
}

function dateLabel(value: string): string {
  if (!value) return "Dates to be planned";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function invitationUrl(inviteId: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", inviteId);
  return url.toString();
}

async function compactImage(file: File, maximumSide = 700): Promise<string> {
  const image = new Image();
  const source = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("That photo could not be opened."));
      image.src = source;
    });
    const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .78);
  } finally {
    URL.revokeObjectURL(source);
  }
}

export default function AccountPortal({ renderTrip }: AccountPortalProps) {
  const pendingInviteId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("join")?.trim() || "";
  }, []);
  const [account, setAccount] = useState<FamilyAccount | null | undefined>(undefined);
  const [trips, setTrips] = useState<AccountTrip[]>([]);
  const [tripsReady, setTripsReady] = useState(false);
  const [activeTrip, setActiveTrip] = useState<AccountTrip | null>(null);
  const [accountMode, setAccountMode] = useState<AccountMode>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountState, setAccountState] = useState<"idle" | "working">("idle");
  const [accountError, setAccountError] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [showJoinTrip, setShowJoinTrip] = useState(() => Boolean(pendingInviteId));
  const [tripName, setTripName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [joinGroupName, setJoinGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [tripActionState, setTripActionState] = useState<"idle" | "working">("idle");
  const [tripActionError, setTripActionError] = useState("");
  const [inviteTrip, setInviteTrip] = useState<AccountTrip | null>(null);
  const [invite, setInvite] = useState<TripInvite | null>(null);
  const [inviteQr, setInviteQr] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileCurrency, setProfileCurrency] = useState("AUD");
  const [profilePhoto, setProfilePhoto] = useState("");
  const [profileX, setProfileX] = useState(50);
  const [profileY, setProfileY] = useState(50);
  const [profileEmoji, setProfileEmoji] = useState("");
  const [profileColor, setProfileColor] = useState("#8bb8cf");
  const [profileState, setProfileState] = useState<"idle" | "saving">("idle");
  const [profileError, setProfileError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const inviteLink = useMemo(() => invite?.id && typeof window !== "undefined" ? invitationUrl(invite.id) : "", [invite]);

  function openProfile() {
    if (!account) return;
    setProfileName(account.displayName);
    setProfileCurrency(account.homeCurrency || "AUD");
    setProfilePhoto(account.profilePhotoDataUrl || "");
    setProfileX(account.profilePhotoX ?? 50);
    setProfileY(account.profilePhotoY ?? 50);
    setProfileEmoji(account.avatarEmoji || "");
    setProfileColor(account.avatarColor || "#8bb8cf");
    setProfileError("");
    setConfirmSignOut(false);
    setShowProfile(true);
  }

  async function chooseProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setProfileError("Choose a photo from your library."); return; }
    try { setProfilePhoto(await compactImage(file)); setProfileX(50); setProfileY(50); }
    catch (error) { setProfileError(firebaseErrorMessage(error)); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setProfileState("saving"); setProfileError("");
    try {
      await updateFamilyProfile(account, { displayName: profileName, homeCurrency: profileCurrency, profilePhotoDataUrl: profilePhoto || undefined, profilePhotoX: profileX, profilePhotoY: profileY, avatarEmoji: profileEmoji, avatarColor: profileColor });
      setShowProfile(false);
    } catch (error) { setProfileError(firebaseErrorMessage(error)); }
    finally { setProfileState("idle"); }
  }

  useEffect(() => {
    let observed = false;
    const openingTimeout = window.setTimeout(() => {
      if (observed) return;
      setAccount(null);
      setAccountError("Account connection is taking longer than expected. You can still sign in or create an account.");
    }, 5_000);

    try {
      const unsubscribe = observeFamilyAccount((nextAccount) => {
        observed = true;
        window.clearTimeout(openingTimeout);
        setAccount(nextAccount);
      });
      return () => {
        window.clearTimeout(openingTimeout);
        unsubscribe();
      };
    } catch (error) {
      window.clearTimeout(openingTimeout);
      const failureTimeout = window.setTimeout(() => {
        setAccount(null);
        setAccountError(firebaseErrorMessage(error));
      }, 0);
      return () => window.clearTimeout(failureTimeout);
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    const cached = readTripShelf(account.uid);
    setTrips(cached);
    setTripsReady(cached.length > 0);
    return observeAccountTrips(account, (nextTrips) => {
      setTrips(nextTrips);
      setTripsReady(true);
      writeTripShelf(account.uid, nextTrips);
    });
  }, [account]);

  useEffect(() => {
    if (!inviteLink) return;
    void QRCode.toDataURL(inviteLink, {
      width: 360,
      margin: 2,
      color: { dark: "#17384a", light: "#fffaf1" },
    }).then(setInviteQr).catch(() => setInviteQr(""));
  }, [inviteLink]);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountState("working");
    setAccountError("");
    setAccountMessage("");
    try {
      if (accountMode === "create") await createFamilyAccount(displayName, email, password);
      else await signInToFamilyAccount(email, password);
    } catch (error) {
      setAccountError(firebaseErrorMessage(error));
    } finally {
      setAccountState("idle");
    }
  }

  async function sendReset() {
    if (!email.trim()) {
      setAccountError("Enter your email address first, then choose Forgot password.");
      return;
    }
    setAccountState("working");
    setAccountError("");
    try {
      await resetFamilyPassword(email);
      setAccountMessage("A password reset email is on its way.");
    } catch (error) {
      setAccountError(firebaseErrorMessage(error));
    } finally {
      setAccountState("idle");
    }
  }

  async function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setTripActionState("working");
    setTripActionError("");
    try {
      const created = await createAccountTrip(account, { name: tripName, groupName, startDate, endDate });
      setShowCreateTrip(false);
      setTripName("");
      setGroupName("");
      setStartDate("");
      setEndDate("");
      setInviteTrip(created.trip);
      setInvite({
        id: created.inviteId,
        tripId: created.trip.id,
        tripName: created.trip.name,
        groupName: created.groupName,
        inviteCode: created.inviteCode,
      });
    } catch (error) {
      setTripActionError(firebaseErrorMessage(error));
    } finally {
      setTripActionState("idle");
    }
  }

  async function joinTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setTripActionState("working");
    setTripActionError("");
    try {
      const joined = pendingInviteId
        ? await joinTripWithInvite(account, pendingInviteId)
        : await joinTripWithCode(account, joinGroupName, joinCode);
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      setShowJoinTrip(false);
      setJoinGroupName("");
      setJoinCode("");
      setActiveTrip(joined);
    } catch (error) {
      setTripActionError(firebaseErrorMessage(error));
    } finally {
      setTripActionState("idle");
    }
  }

  async function connectVienna() {
    if (!account) return;
    setTripActionState("working");
    setTripActionError("");
    try {
      const vienna = await attachLegacyViennaTrip(account);
      setActiveTrip(vienna);
    } catch (error) {
      setTripActionError(firebaseErrorMessage(error));
    } finally {
      setTripActionState("idle");
    }
  }

  async function openInvite(trip: AccountTrip) {
    if (!account || trip.role !== "admin") return;
    setTripActionError("");
    setInviteTrip(trip);
    try {
      setInvite(await readTripInviteForAdmin(account, trip));
    } catch (error) {
      setTripActionError(firebaseErrorMessage(error));
    }
  }

  async function replaceInvite() {
    if (!account || !inviteTrip || !invite) return;
    setTripActionState("working");
    setTripActionError("");
    try {
      const next = await rotateTripInvite(account, inviteTrip, invite.groupName);
      setInvite({ ...invite, id: next.inviteId, inviteCode: next.inviteCode });
    } catch (error) {
      setTripActionError(firebaseErrorMessage(error));
    } finally {
      setTripActionState("idle");
    }
  }

  if (!firebaseConfigured) {
    return (
      <main className="account-shell">
        <section className="account-card setup-card">
          <p className="eyebrow">A safer group space is on its way</p>
          <h1>Connecting group accounts</h1>
          <p>The existing Vienna trip is still safe. Account setup needs to be completed before this screen is published.</p>
        </section>
      </main>
    );
  }

  if (account === undefined) {
    return <main className="zora-loading-shell"><ZoraLoader /></main>;
  }

  if (!account) {
    return (
      <main className="account-shell">
        <section className="account-welcome">
          <div className="account-welcome-copy">
            <p className="eyebrow">Plan it together. Remember it forever.</p>
            <h1>Your group adventures, all in one place.</h1>
            <p>Sign in on your phone, iPad or laptop and every trip you belong to will be waiting for you.</p>
          </div>
          <section className="account-card auth-card" aria-labelledby="account-title">
            <div className="auth-switch" role="tablist" aria-label="Account options">
              <button className={accountMode === "sign-in" ? "active" : ""} onClick={() => { setAccountMode("sign-in"); setAccountError(""); }}>Sign in</button>
              <button className={accountMode === "create" ? "active" : ""} onClick={() => { setAccountMode("create"); setAccountError(""); }}>Create account</button>
            </div>
            <p className="eyebrow">{pendingInviteId ? "Your invitation is ready" : "Welcome back"}</p>
            <h2 id="account-title">{accountMode === "create" ? "Make your travel account" : "Open your adventures"}</h2>
            <form className="account-form" onSubmit={submitAccount}>
              {accountMode === "create" && <label><span>Your name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label>}
              <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
              <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={accountMode === "create" ? "new-password" : "current-password"} minLength={6} required /></label>
              {accountError && <p className="account-alert" role="alert">{accountError}</p>}
              {accountMessage && <p className="account-success" role="status">{accountMessage}</p>}
              <button className="primary-button" disabled={accountState === "working"}>{accountState === "working" ? "One moment…" : accountMode === "create" ? "Create my account" : "Sign in"}</button>
              {accountMode === "sign-in" && <button type="button" className="text-button" onClick={() => void sendReset()} disabled={accountState === "working"}>Forgot password?</button>}
            </form>
          </section>
        </section>
      </main>
    );
  }

  if (activeTrip) return <>{renderTrip(account, activeTrip, () => setActiveTrip(null))}</>;

  return (
    <main className="account-shell trips-shell">
      <header className="trips-header">
        <div><p className="eyebrow">Welcome back, {account.displayName}</p><h1>My Adventures</h1><p>Where are we going—and which story are we opening again?</p></div>
        <button className="profile-button" onClick={openProfile} aria-label="Open your profile settings">
          {account.profilePhotoDataUrl ? <span style={{ backgroundImage: `url(${account.profilePhotoDataUrl})`, backgroundPosition: `${account.profilePhotoX}% ${account.profilePhotoY}%` }} /> : <span style={{ backgroundColor: account.avatarColor }}>{account.avatarEmoji || account.displayName.slice(0, 1).toUpperCase()}</span>}
        </button>
      </header>

      <section className="trip-dashboard-actions" aria-label="Trip actions">
        <button className="create-trip-card" onClick={() => { setTripActionError(""); setShowCreateTrip(true); }}><span aria-hidden="true">＋</span><strong>Create New Trip</strong><small>You’ll be the trip admin</small></button>
        <button className="join-trip-card" onClick={() => { setTripActionError(""); setShowJoinTrip(true); }}><span aria-hidden="true">⌁</span><strong>Join a Trip</strong><small>Use a QR link or private code</small></button>
        {!trips.some((trip) => trip.id === legacyViennaTripId) && (
          <button className="join-trip-card" onClick={() => void connectVienna()} disabled={tripActionState === "working"}>
            <span aria-hidden="true">✈︎</span><strong>Connect Vienna Trip</strong><small>Bring in the trip you already built</small>
          </button>
        )}
      </section>

      {tripActionError && <p className="account-alert dashboard-alert" role="alert">{tripActionError}</p>}

      <section className="trip-library" aria-labelledby="trip-library-title">
        <div className="trip-library-heading"><p className="eyebrow">Your travel shelf</p><h2 id="trip-library-title">Trips you belong to</h2></div>
        {!tripsReady ? (
          <ZoraLoader compact message="Bringing your adventures up to date" />
        ) : trips.length === 0 ? (
          <div className="empty-trip-library">
            <span aria-hidden="true">🧳</span><h3>Your first adventure belongs here</h3><p>Create a trip, or connect the Vienna trip you already built.</p>
            <button className="secondary-button" onClick={() => void connectVienna()} disabled={tripActionState === "working"}>{tripActionState === "working" ? "Connecting…" : "Connect my 2026 Vienna Trip"}</button>
          </div>
        ) : (
          <div className="trip-card-grid">
            {trips.map((trip) => (
              <article className="account-trip-card" key={trip.id}>
                <button className={`trip-card-open ${trip.coverThumbnailDataUrl ? "has-cover" : ""}`} onClick={() => setActiveTrip(trip)} style={trip.coverThumbnailDataUrl ? { backgroundImage: `linear-gradient(180deg, rgba(17,39,49,.08), rgba(17,39,49,.78)), url(${trip.coverThumbnailDataUrl})`, backgroundPosition: `center, ${trip.coverPositionX ?? 50}% ${trip.coverPositionY ?? 50}%` } : undefined}>
                  <span className="trip-role">{trip.role === "admin" ? "Admin" : "Contributor"}</span>
                  <h3>{trip.name}</h3>
                  <p>{dateLabel(trip.startDate)}{trip.endDate && trip.endDate !== trip.startDate ? ` — ${dateLabel(trip.endDate)}` : ""}</p>
                  <strong>Open trip <span aria-hidden="true">→</span></strong>
                </button>
                {trip.role === "admin" && <button className="trip-card-invite" onClick={() => void openInvite(trip)}>Invite people</button>}
              </article>
            ))}
          </div>
        )}
      </section>

      {showProfile && (
        <div className="modal-backdrop profile-backdrop" role="presentation" onMouseDown={() => setShowProfile(false)}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Your travel profile</p><h2 id="profile-title">Make it feel like you</h2>
            <form className="account-form" onSubmit={saveProfile}>
              <div className="profile-photo-editor">
                <div className="profile-photo-preview" style={profilePhoto ? { backgroundImage: `url(${profilePhoto})`, backgroundPosition: `${profileX}% ${profileY}%` } : { backgroundColor: profileColor }}>{!profilePhoto && (profileEmoji || profileName.slice(0, 1).toUpperCase())}</div>
                <div><label className="secondary-button profile-photo-picker">Choose profile photo<input className="visually-hidden" type="file" accept="image/*" onChange={chooseProfilePhoto} /></label><small>Use the sliders to choose what stays in the circle.</small></div>
              </div>
              {profilePhoto && <div className="focal-controls"><label><span>Move photo left or right</span><input type="range" min="0" max="100" value={profileX} onChange={(event) => setProfileX(Number(event.target.value))} /></label><label><span>Move photo up or down</span><input type="range" min="0" max="100" value={profileY} onChange={(event) => setProfileY(Number(event.target.value))} /></label></div>}
              <section className="profile-bubble-editor" aria-labelledby="profile-bubble-title">
                <div className="profile-bubble-heading"><span className="profile-bubble-preview" style={{ background: profileColor }}>{profileEmoji || profileName.slice(0, 1).toUpperCase()}</span><div><strong id="profile-bubble-title">Your group bubble</strong><small>Use your initial or choose any emoji and colour.</small></div></div>
                <div className="profile-emoji-options"><button type="button" className={!profileEmoji ? "active" : ""} onClick={() => { setProfileEmoji(""); setProfilePhoto(""); }}>Initial</button>{["😊","🌸","🌞","🦋","🍓","🌿","🐨","✨"].map((emoji) => <button type="button" className={profileEmoji === emoji ? "active" : ""} onClick={() => { setProfileEmoji(emoji); setProfilePhoto(""); }} key={emoji}>{emoji}</button>)}</div>
                <label className="custom-emoji-field"><span>Or type any emoji</span><input value={profileEmoji} onChange={(event) => { setProfileEmoji(Array.from(event.target.value).slice(0, 2).join("")); setProfilePhoto(""); }} placeholder="🎨" /></label>
                <div className="profile-color-options" aria-label="Bubble background colour">{["#f3a6b8","#d7afe8","#f5a27d","#f6c96b","#9dcf9f","#8bb8cf","#9faee8","#78c7c0","#c8a6d9","#aacb78"].map((color) => <button type="button" className={profileColor === color ? "active" : ""} style={{ background: color }} onClick={() => setProfileColor(color)} key={color} aria-label="Choose this pastel colour" />)}</div>
              </section>
              <label><span>Your name</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} required /></label>
              <label><span>Default home currency</span><select value={profileCurrency} onChange={(event) => setProfileCurrency(event.target.value)}>{["AUD","EUR","USD","GBP","NZD","CAD","JPY","CHF","SGD","HKD"].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              {profileError && <p className="account-alert" role="alert">{profileError}</p>}
              <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowProfile(false)}>Cancel</button><button className="primary-button" disabled={profileState === "saving"}>{profileState === "saving" ? "Saving…" : "Save profile"}</button></div>
            </form>
            <div className="profile-signout"><p><strong>Finished for now?</strong><small>Your trips stay safe and ready for next time.</small></p>{confirmSignOut ? <><button className="text-button danger-text" onClick={() => void signOutOfFamilyAccount()}>Confirm sign out</button><button className="text-button" onClick={() => setConfirmSignOut(false)}>Stay signed in</button></> : <button className="text-button" onClick={() => setConfirmSignOut(true)}>Sign out</button>}</div>
          </section>
        </div>
      )}

      {showCreateTrip && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreateTrip(false)}>
          <section className="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="create-trip-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">A new adventure</p><h2 id="create-trip-title">Create New Trip</h2>
            <form className="account-form" onSubmit={createTrip}>
              <label><span>Trip name</span><input value={tripName} onChange={(event) => setTripName(event.target.value)} placeholder="e.g. 2027 Japan Trip" required /></label>
              <label><span>Private group name</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Something only your group knows" required /></label>
              <div className="account-date-row">
                <label><span>Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
                <label><span>End date</span><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
              </div>
              {tripActionError && <p className="account-alert" role="alert">{tripActionError}</p>}
              <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreateTrip(false)}>Cancel</button><button className="primary-button" disabled={tripActionState === "working"}>{tripActionState === "working" ? "Creating…" : "Create trip"}</button></div>
            </form>
          </section>
        </div>
      )}

      {showJoinTrip && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowJoinTrip(false)}>
          <section className="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="join-trip-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Join the adventure</p><h2 id="join-trip-title">{pendingInviteId ? "Private invitation found" : "Enter the private trip details"}</h2>
            <form className="account-form" onSubmit={joinTrip}>
              {pendingInviteId ? <p className="invite-found">You’re signed in and ready to join. The trip will be added to My Adventures.</p> : <><label><span>Private group name</span><input value={joinGroupName} onChange={(event) => setJoinGroupName(event.target.value)} required /></label><label><span>Private invite code</span><input className="invite-code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={8} required /></label></>}
              {tripActionError && <p className="account-alert" role="alert">{tripActionError}</p>}
              <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowJoinTrip(false)}>Cancel</button><button className="primary-button" disabled={tripActionState === "working"}>{tripActionState === "working" ? "Joining…" : "Join trip"}</button></div>
            </form>
          </section>
        </div>
      )}

      {inviteTrip && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { setInviteTrip(null); setInvite(null); }}>
          <section className="modal invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">Bring everyone along</p><h2 id="invite-title">Invite people to {inviteTrip.name}</h2>
            {invite ? <>
              <div className="invite-qr">{inviteQr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={inviteQr} alt={`QR invitation for ${inviteTrip.name}`} />
              ) : <span>Making QR code…</span>}</div>
              <p className="invite-instruction">They can scan this QR code, or join with the private group name and invite code below.</p>
              <div className="manual-invite-details"><p><span>Private group name</span><strong>{invite.groupName}</strong></p><p><span>Private invite code</span><strong className="invite-code">{invite.inviteCode || "Generate a new code"}</strong></p></div>
              <p className="invite-security-note">Anyone with either invitation method can join. Replace the code if it is shared outside your group.</p>
              <div className="modal-actions"><button className="text-button" onClick={() => void replaceInvite()} disabled={tripActionState === "working"}>{tripActionState === "working" ? "Replacing…" : "Replace invite code"}</button><button className="secondary-button" onClick={() => { setInviteTrip(null); setInvite(null); }}>Done</button></div>
            </> : <p>Opening the private invitation…</p>}
          </section>
        </div>
      )}
    </main>
  );
}
