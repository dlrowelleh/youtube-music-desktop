const { ipcRenderer } = require("electron");

let localPlaylist = [];
let currentIndex = -1;
let isPlaying = false;
let isLoading = false;
let nextStreamUrl = "";

const audioPlayer = document.getElementById("audioPlayer");
const playPauseButton = document.getElementById("playPauseButton");
const prevButton = document.getElementById("prevButton");
const nextButton = document.getElementById("nextButton");
const volumeSlider = document.getElementById("volumeSlider");
const progressBar = document.querySelector(".progress");
const songTitle = document.querySelector(".song-title");
const songDuration = document.querySelector(".song-duration");
const volumeIcon = document.querySelector(
  ".volume-control .material-icons-round"
);

playPauseButton.addEventListener("click", togglePlayPause);
prevButton.addEventListener("click", playPrevious);
nextButton.addEventListener("click", playNext);
volumeSlider.addEventListener("input", handleVolumeChange);

const progressContainer = document.querySelector(".progress-bar");
progressContainer.addEventListener("click", handleProgressBarClick);

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function updateProgress() {
  if (audioPlayer.duration) {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressBar.style.width = `${progress}%`;
    songDuration.textContent = `${formatTime(
      audioPlayer.currentTime
    )} / ${formatTime(audioPlayer.duration)}`;
  }
}

function handleProgressBarClick(e) {
  const rect = progressContainer.getBoundingClientRect();
  const clickPosition = (e.clientX - rect.left) / rect.width;
  audioPlayer.currentTime = clickPosition * audioPlayer.duration;
}

function togglePlayPause() {
  // Check if there's a song in the playlist and a valid currentIndex
  if (
    localPlaylist.length === 0 ||
    currentIndex < 0 ||
    currentIndex >= localPlaylist.length
  ) {
    // No song is available to play
    return;
  }

  if (audioPlayer.paused) {
    audioPlayer.play();
    playPauseButton.querySelector(".material-icons-round").textContent =
      "pause";
    isPlaying = true;
  } else {
    audioPlayer.pause();
    playPauseButton.querySelector(".material-icons-round").textContent =
      "play_arrow";
    isPlaying = false;
  }
}

function handleVolumeChange() {
  const volume = volumeSlider.value / 100;
  audioPlayer.volume = volume;
  localStorage.setItem("volume", volumeSlider.value);

  if (volume === 0) {
    volumeIcon.textContent = "volume_off";
  } else if (volume < 0.5) {
    volumeIcon.textContent = "volume_down";
  } else {
    volumeIcon.textContent = "volume_up";
  }
}

function playPrevious() {
  if (currentIndex > 0) {
    currentIndex--;
    playCurrentSong();
  }
}

function playNext() {
  if (currentIndex < localPlaylist.length - 1 && !isLoading) {
    currentIndex++;
    playCurrentSong();
  }
}

function preloadStream(index) {
  if (index < 0 || index >= localPlaylist.length) return;

  const nextUrl = localPlaylist[index].url;
  ipcRenderer.send("preload-audio", nextUrl);
}

document.getElementById("playButton").addEventListener("click", () => {
  const videoUrl = document.getElementById("videoUrl").value;
  if (videoUrl) {
    if (videoUrl.match(/https:\/\/www\.youtube\.com\/playlist\?list=/)) {
      ipcRenderer.send("fetch-playlist", videoUrl);
    } else if (
      videoUrl.match(/https:\/\/www\.youtube\.com\/watch\?v=.+&list=/)
    ) {
      ipcRenderer.send("fetch-playlist", videoUrl);
    } else {
      ipcRenderer.send("fetch-video-metadata", videoUrl);
    }
    document.getElementById("videoUrl").value = "";
  }
});

ipcRenderer.on("video-metadata-success", (event, metadata) => {
  const newTrack = {
    title: metadata.title,
    thumbnail: metadata.thumbnail,
    url: metadata.webpage_url,
  };
  localPlaylist.push(newTrack);

  if (!isPlaying) {
    currentIndex = localPlaylist.length - 1;
    playCurrentSong();
  } else {
    updatePlaylistUI();
  }
});

ipcRenderer.on("video-metadata-failure", (event, errorMessage) => {
  alert("메타데이터를 불러오는 중 오류 발생: " + errorMessage);
});

function playCurrentSong() {
  const currentThumbnail = document.getElementById("currentThumbnail");

  if (currentIndex >= 0 && currentIndex < localPlaylist.length) {
    const track = localPlaylist[currentIndex];
    isLoading = true;
    audioPlayer.pause();
    audioPlayer.src = "";
    songTitle.textContent = `${track.title} 로딩 중...`;

    const iconElement = playPauseButton.querySelector(".material-icons-round");
    iconElement.textContent = "refresh";
    iconElement.classList.add("loading-spinner");

    ipcRenderer.send("play-audio", track.url);

    currentThumbnail.src = track.thumbnail;
    currentThumbnail.style.display = "block";

    preloadStream(currentIndex + 1);
    updatePlaylistUI();
  } else {
    currentThumbnail.style.display = "none";
  }
}

ipcRenderer.on("play-audio-success", (event, streamUrl) => {
  audioPlayer.src = streamUrl;
  audioPlayer.play();

  const iconElement = playPauseButton.querySelector(".material-icons-round");
  iconElement.classList.remove("loading-spinner");
  iconElement.textContent = "pause";
  isPlaying = true;
  isLoading = false;
  songTitle.textContent = `${localPlaylist[currentIndex].title} 재생 중`;

  preloadNextSong();
});

audioPlayer.addEventListener("timeupdate", updateProgress);
audioPlayer.addEventListener("ended", () => {
  playNext();
});

ipcRenderer.on("play-audio-success", (event, streamUrl) => {
  audioPlayer.src = streamUrl;
  audioPlayer.play();

  const iconElement = playPauseButton.querySelector(".material-icons-round");
  iconElement.classList.remove("loading-spinner");
  iconElement.textContent = "pause";
  isPlaying = true;
  isLoading = false;
  songTitle.textContent = `${localPlaylist[currentIndex].title} 재생 중`;

  preloadNextSong();
});

function shufflePlaylist() {
  if (localPlaylist.length <= 1) return;

  const isSongPlaying =
    currentIndex >= 0 && currentIndex < localPlaylist.length;

  const currentTrack = isSongPlaying ? localPlaylist[currentIndex] : null;

  for (let i = localPlaylist.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [localPlaylist[i], localPlaylist[j]] = [localPlaylist[j], localPlaylist[i]];
  }

  if (currentTrack) {
    currentIndex = localPlaylist.findIndex(
      (track) => track.url === currentTrack.url
    );
  }

  updatePlaylistUI();
}

function clearPlaylist() {
  localPlaylist = [];
  currentIndex = -1;
  updatePlaylistUI();
}

function updatePlaylistUI() {
  const playlistContainer = document.getElementById("playlistContainer");
  playlistContainer.innerHTML = "";

  localPlaylist.forEach((track, index) => {
    const li = document.createElement("li");

    const thumbnailImg = document.createElement("img");
    thumbnailImg.src = track.thumbnail;
    thumbnailImg.alt = track.title;
    thumbnailImg.className = "thumbnail";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = ` ${track.title}`;

    li.appendChild(thumbnailImg);
    li.appendChild(titleSpan);

    if (index === currentIndex) {
      li.style.fontWeight = "bold";
      songTitle.textContent = `${track.title} 재생 중`;
    }

    li.addEventListener("click", () => {
      currentIndex = index;
      playCurrentSong();
    });

    playlistContainer.appendChild(li);
  });

  localStorage.setItem("playlist", JSON.stringify(localPlaylist));
}

document.getElementById("googleLoginButton").addEventListener("click", () => {
  ipcRenderer.send("google-login");
});

ipcRenderer.on("prompt-auth-code", () => {
  const authCode = prompt(
    "Google 인증 후 URL에서 코드 값을 복사하여 입력하세요:"
  );
  if (authCode) {
    ipcRenderer.send("submit-auth-code", authCode);
  }
});

ipcRenderer.on("google-login-success", (event, message) => {
  alert(message);
});

ipcRenderer.on("playlists", (event, playlists) => {
  const googleTracks = playlists.map((title, index) => ({
    title: title,
    thumbnail: "https://via.placeholder.com/50",
    url: `placeholder-url-${index}`,
  }));
  localPlaylist = localPlaylist.concat(googleTracks);
  updatePlaylistUI();
});

ipcRenderer.on("playlist-success", (event, playlistData) => {
  const tracks = playlistData.videos.map((video) => ({
    title: video.title,
    thumbnail: video.thumbnail,
    url: video.url,
  }));
  localPlaylist = localPlaylist.concat(tracks);
  updatePlaylistUI();
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("currentThumbnail").style.display = "none";
  const savedVolume = localStorage.getItem("volume");
  if (savedVolume !== null) {
    volumeSlider.value = savedVolume;
    handleVolumeChange();
  }

  const savedPlaylist = localStorage.getItem("playlist");
  if (savedPlaylist) {
    localPlaylist = JSON.parse(savedPlaylist);
    updatePlaylistUI();
  }

  document.getElementById("currentThumbnail").style.display = "none";
  document
    .getElementById("shuffleButton")
    .addEventListener("click", shufflePlaylist);
  document
    .getElementById("clearPlaylistButton")
    .addEventListener("click", clearPlaylist);
});

nextButton.addEventListener("click", () => {
  if (!isLoading) playNext();
});
prevButton.addEventListener("click", () => {
  if (!isLoading) playPrevious();
});
