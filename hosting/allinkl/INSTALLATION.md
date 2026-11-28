# Bereitstellung auf ALL-INKL (mallorcasstreetlife.dennissunshinetv.de)

Der Spielserver für Anmeldung, Registrierung und Speicherstand liegt hier als PHP-Version vor (`api/`),
weil ALL-INKL kein Node.js ausführt. Die Spieldateien selbst sind reine Browser-Dateien.

## Erstinstallation

1. Im KAS für die Subdomain eine aktuelle PHP-Version wählen (getestet ist PHP 8.3). `pdo_sqlite` wird benötigt.
2. Lokal `node build.js` ausführen. Der Ordner `dist/` ist dann das komplette Paket.
3. **Den ganzen Inhalt von `dist/`** in das Stammverzeichnis der Subdomain hochladen. Die versteckte Datei
   `.htaccess` (und `api/data/.htaccess`) muss mit übertragen werden. Die Dateien `server.js`, `users.js` und
   `package.json` werden auf dem Server nicht benötigt (die `.htaccess` sperrt sie).
4. `http://mallorcasstreetlife.dennissunshinetv.de/api/status.php` öffnen: `ok`, `pdo_sqlite`, `data_directory_writable` und
   `database` müssen `true` sein. Bei einem Fehler steht die Ursache in `fatal` oder `error`, `members` zeigt die Zahl der Mitglieder.
5. **Zuerst den Hauptaccount registrieren:** Der Name `DennisSunshineTV` erhält automatisch den Rang **Sysadmin**.
   Wer ihn zuerst registriert, bekommt ihn. Bei Bedarf in `api/config.php` die eigene E-Mail-Adresse festlegen:
   `<?php define('SYSADMIN_EMAIL', 'deine@mail.de');`. Dann darf nur diese Adresse den Namen belegen.

## Aktualisierung

Neues `dist/` hochladen und die vorhandenen Dateien überschreiben. **Den Ordner `api/data` nicht löschen oder
ersetzen**, er enthält die Datenbank `game.sqlite` (die Mitglieder-Datenbank) mit Konten und Speicherständen. Vorher sichern.

## Hinweise

- Die Mitglieder-Datenbank `api/data/game.sqlite` (Tabellen `users`, `sessions`, `saves`) wird beim ersten Aufruf automatisch angelegt. Eine MySQL-Datenbank im KAS ist nicht nötig.
- Die Mitgliederliste (Name, E-Mail, Rang, Registrierung, IP) siehst du als Sysadmin/Admin auf der Startseite über den Knopf „Mitglieder“.
- Das Protokoll (Registrierungen und Logins mit IP-Adresse, Betriebssystem und Browser, die letzten 5000 Einträge) steht im Admin-Menü unter „Protokoll“. Bestehende Datenbanken werden beim ersten Aufruf automatisch um die neuen Spalten ergänzt (Mitglieder, die sich früher registriert haben, zeigen „–“ als Betriebssystem).
- Die Spieldateien (`/game/`, `/vendor/`) liefert `api/static.php` nur an eingeloggte Spieler aus.
- Auf HTTPS umstellen (SSL im KAS aktivieren): Dann setzt die API das Cookie automatisch mit dem Zusatz „Secure“.
