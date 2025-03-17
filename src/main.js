const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const { google } = require("googleapis");

let mainWindow;
let oauth2Client;
const streamUrlCache = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("src/ui/html/index.html");
}

app.whenReady().then(createWindow);

const isDev = !app.isPackaged;

const ytdlpPath = isDev
  ? path.join(__dirname, "player", "yt-dlp", "yt-dlp.exe")
  : path.join(process.resourcesPath, "player", "yt-dlp", "yt-dlp.exe");

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on("preload-audio", (event, videoUrl) => {
  if (streamUrlCache[videoUrl]) {
    event.reply("preload-audio-success", streamUrlCache[videoUrl]);
    return;
  }

  const args = ["-f", "bestaudio[abr<=128]", "-g", videoUrl];
  const ytdlp = spawn(ytdlpPath, args);

  let streamUrl = "";
  ytdlp.stdout.on("data", (data) => {
    streamUrl += data.toString();
  });

  ytdlp.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  ytdlp.on("close", (code) => {
    if (code === 0 && streamUrl) {
      const cleanUrl = streamUrl.trim();
      streamUrlCache[videoUrl] = cleanUrl;
      event.reply("preload-audio-success", cleanUrl, videoUrl);
    }
  });
});

ipcMain.on("play-audio", (event, videoUrl) => {
  if (!videoUrl) {
    dialog.showErrorBox("오류", "동영상 URL이 입력되지 않았습니다.");
    return;
  }

  if (streamUrlCache[videoUrl]) {
    event.reply("play-audio-success", streamUrlCache[videoUrl]);
    return;
  }

  const args = ["-f", "bestaudio[abr<=128]", "-g", videoUrl];
  const ytdlp = spawn(ytdlpPath, args);

  let streamUrl = "";
  ytdlp.stdout.on("data", (data) => {
    streamUrl += data.toString();
  });

  ytdlp.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  ytdlp.on("close", (code) => {
    if (code === 0 && streamUrl) {
      const cleanUrl = streamUrl.trim();
      streamUrlCache[videoUrl] = cleanUrl;
      event.reply("play-audio-success", cleanUrl);
    } else {
      dialog.showErrorBox("오류", `yt-dlp가 코드 ${code}로 종료되었습니다.`);
    }
  });
});

ipcMain.on("fetch-video-metadata", (event, videoUrl) => {
  if (!videoUrl) {
    dialog.showErrorBox("오류", "동영상 URL이 입력되지 않았습니다.");
    return;
  }

  const args = ["-J", "--skip-download", videoUrl];
  const ytDlp = spawn(ytdlpPath, args);

  let jsonData = "";
  ytDlp.stdout.on("data", (data) => {
    jsonData += data.toString();
  });
  ytDlp.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });
  ytDlp.on("close", (code) => {
    if (code === 0 && jsonData) {
      try {
        const metadata = JSON.parse(jsonData);

        event.reply("video-metadata-success", metadata);
      } catch (err) {
        event.reply("video-metadata-failure", "JSON 파싱 오류");
      }
    } else {
      event.reply(
        "video-metadata-failure",
        `yt-dlp가 코드 ${code}로 종료되었습니다.`
      );
    }
  });
});

ipcMain.on("google-login", async (event) => {
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync("src/static/client_secret.json"));
  } catch (err) {
    dialog.showErrorBox(
      "오류",
      "client_secret.json 파일이 없거나 올바르지 않습니다."
    );
    return;
  }

  const { client_id, client_secret, redirect_uris } = credentials.installed;
  oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const scopes = ["https://www.googleapis.com/auth/youtube.readonly"];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  shell.openExternal(authUrl);

  event.reply("prompt-auth-code");
});

ipcMain.on("submit-auth-code", async (event, authCode) => {
  if (!oauth2Client) {
    dialog.showErrorBox("오류", "OAuth2 클라이언트가 초기화되지 않았습니다.");
    return;
  }
  try {
    const { tokens } = await oauth2Client.getToken(authCode);
    oauth2Client.setCredentials(tokens);
    event.reply("google-login-success", "로그인에 성공했습니다!");
    fetchPlaylists();
  } catch (err) {
    dialog.showErrorBox(
      "오류",
      "액세스 토큰을 가져오는 중 오류가 발생했습니다."
    );
  }
});

ipcMain.on("fetch-playlist", async (event, playlistUrl) => {
  try {
    const playlistData = await fetchPlaylistVideos(playlistUrl);
    event.reply("playlist-success", playlistData);
  } catch (err) {
    dialog.showErrorBox(
      "오류",
      "플레이리스트를 가져오는 중 오류가 발생했습니다."
    );
    console.error(err);
  }
});

async function fetchPlaylistVideos(playlistUrl) {
  return new Promise((resolve, reject) => {
    const args = ["--flat-playlist", "--print-json", playlistUrl];
    const ytDlp = spawn(ytdlpPath, args);

    const videos = [];
    let errorOutput = "";

    ytDlp.stdout.on("data", (data) => {
      data
        .toString()
        .split("\n")
        .forEach((line) => {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              videos.push({
                title: entry.title,
                thumbnail:
                  entry.thumbnail ||
                  `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
                url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
              });
            } catch (parseErr) {
              console.error("JSON 파싱 오류:", parseErr.message);
            }
          }
        });
    });

    ytDlp.stderr.on("data", (data) => {
      errorOutput += data.toString();
      console.error(`stderr: ${data}`);
    });

    ytDlp.on("close", (code) => {
      if (code === 0 && videos.length > 0) {
        resolve({
          title: "플레이리스트",
          videos,
        });
      } else {
        reject(`yt-dlp가 코드 ${code}로 종료되었습니다.\n${errorOutput}`);
      }
    });
  });
}

async function fetchPlaylists() {
  if (!oauth2Client) return;
  const service = google.youtube("v3");
  try {
    const res = await service.playlists.list({
      auth: oauth2Client,
      part: "snippet,contentDetails",
      mine: true,
      maxResults: 25,
    });
    const playlists = res.data.items.map((item) => item.snippet.title);
    mainWindow.webContents.send("playlists", playlists);
  } catch (err) {
    dialog.showErrorBox(
      "오류",
      "플레이리스트를 가져오는 중 오류가 발생했습니다."
    );
  }
}
