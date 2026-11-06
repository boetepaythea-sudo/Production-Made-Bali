import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, inMemoryPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, onSnapshot, addDoc, getDocs, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

                            const firebaseConfig = {
                                apiKey: "AIzaSyCqmojmZagGLMpxpemlhf3L0u42lShW6NM",
                                authDomain: "pia-made-bali.firebaseapp.com",
                                projectId: "pia-made-bali",
                                storageBucket: "pia-made-bali.firebasestorage.app",
                                messagingSenderId: "140052385978",
                                appId: "1:140052385978:web:64b934a162de955f01b283",
                                measurementId: "G-M0QC6C6VNS"
                            };

                            const app = initializeApp(firebaseConfig);
                            const auth = getAuth(app);
                            const db = getFirestore(app);

                            /* ================= SECURE SESSION LOGIN ================= */
                            // Sesi hanya disimpan di memori. Reload/tutup tab = wajib login ulang.
                            const sessionReady = setPersistence(auth, inMemoryPersistence)
                                .catch((error) => {
                                    console.error("Gagal mengatur session persistence:", error);
                                    throw error;
                                });

                            let idleTimer = null;
                            let loginAttempt = Number(sessionStorage.getItem("madeBaliLoginAttempt") || 0);
                            let loginLocked = sessionStorage.getItem("madeBaliLoginLocked") === "true";
                            let loginInProgress = false;

                            function showLoginLocked() {
                                loginLocked = true;
                                sessionStorage.setItem("madeBaliLoginLocked", "true");

                                const emailInput = document.getElementById("email");
                                const passwordInput = document.getElementById("password");
                                const loginButton = document.querySelector(".login-submit");
                                const errorBox = document.getElementById("error");

                                if (emailInput) emailInput.disabled = true;
                                if (passwordInput) passwordInput.disabled = true;
                                if (loginButton) {
                                    loginButton.disabled = true;
                                    loginButton.innerHTML = '<span>AKSES DIKUNCI</span><i class="fa-solid fa-lock"></i>';
                                }
                                if (errorBox) {
                                    errorBox.innerHTML =
                                        'Akses dikunci karena 3 kali percobaan login gagal. Tutup tab aplikasi ini, lalu buka kembali untuk memulai sesi login baru.';
                                }
                            }

                            function clearIdleTimer() {
                                if (idleTimer) {
                                    clearTimeout(idleTimer);
                                    idleTimer = null;
                                }
                            }

                            function resetIdleTimer() {
                                clearIdleTimer();
                                if (!auth.currentUser) return;

                                idleTimer = setTimeout(async () => {
                                    try {
                                        if (window.Swal) {
                                            await Swal.fire({
                                                icon: "warning",
                                                title: "Sesi Berakhir",
                                                text: "Anda logout otomatis karena tidak ada aktivitas selama 30 menit.",
                                                confirmButtonText: "Login Kembali"
                                            });
                                        } else {
                                            alert("Anda logout otomatis karena tidak ada aktivitas selama 30 menit.");
                                        }
                                    } finally {
                                        await logout();
                                    }
                                }, 30 * 60 * 1000);
                            }

                            function startIdleTimer() {
                                const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
                                events.forEach(event => {
                                    document.addEventListener(event, resetIdleTimer, { passive: true });
                                });
                                resetIdleTimer();
                            }

                            function stopIdleTimer() {
                                clearIdleTimer();
                            }

                            // Ketika dokumen benar-benar ditinggalkan / ditutup / navigasi ke halaman lain.
                            // In-memory persistence juga memastikan reload tidak memulihkan sesi.
                            window.addEventListener("pagehide", () => {
                                stopIdleTimer();
                                try {
                                    signOut(auth).catch(error =>
                                        console.warn("Sign out saat pagehide:", error)
                                    );
                                } catch (error) {
                                    console.warn("Pagehide sign out:", error);
                                }
                            });

                            /* Tunggu persistence disiapkan sebelum memeriksa status login. */
                            await sessionReady;

                            onAuthStateChanged(auth, (user) => {
                                const loginPage = document.getElementById("loginPage");
                                const dashboardPage = document.getElementById("dashboardPage");

                                if (user && !loginLocked) {
                                    if (loginPage) loginPage.style.display = "none";
                                    if (dashboardPage) dashboardPage.style.display = "block";

                                    const userEmail = document.getElementById("userEmail");
                                    if (userEmail) userEmail.textContent = user.email || "";
                                    startIdleTimer();

                                    // Data aplikasi baru dimuat setelah autentikasi berhasil.
                                    // Ini mencegah semua query Firestore berjalan di belakang layar login.
                                    if (!appDataInitialized) {
                                        loadAll();
                                    } else {
                                        refreshDashboard();
                                    }
                                } else {
                                    stopIdleTimer();
                                    if (dashboardPage) dashboardPage.style.display = "none";
                                    if (loginPage) loginPage.style.display = "flex";
                                    if (loginLocked) showLoginLocked();
                                }
                            });

                            let currentMaster = "";
                            let recipeItems = [];
                            let forecastSource = "forecast";

                            // =====================================================
                            // GLOBAL NUMBER FORMAT
                            // =====================================================

                            // Untuk nilai uang / value (2 desimal)
                            function formatNumber(value) {
                                return Number(value).toLocaleString("id-ID", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                });
                            }

                            // Untuk gramasi / berat (maksimal 6 desimal)
                            function formatWeight(value) {
                                return Number(value).toLocaleString("id-ID", {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 6
                                });
                            }

                            // Konversi format Indonesia ke Number
                            function parseNumberID(value) {
                                return Number(
                                    String(value)
                                        .replace(/\./g, "")
                                        .replace(",", ".")
                                ) || 0;
                            }

                            /* ================= RESPONSIVE SIDEBAR ================= */
                            window.toggleAppSidebar = function(forceState) {
                                const sidebar = document.getElementById("appSidebar");
                                const overlay = document.getElementById("appSidebarOverlay");
                                const toggle = document.querySelector(".mobile-sidebar-toggle");
                                if (!sidebar || !overlay) return;

                                const shouldOpen = typeof forceState === "boolean"
                                    ? forceState
                                    : !sidebar.classList.contains("mobile-open");

                                sidebar.classList.toggle("mobile-open", shouldOpen);
                                overlay.classList.toggle("visible", shouldOpen);
                                if (toggle) toggle.setAttribute("aria-expanded", String(shouldOpen));
                                document.body.classList.toggle("sidebar-drawer-open", shouldOpen);
                            };

                            /* ================= LOGIN ================= */
                            async function login() {
                                if (loginLocked || loginInProgress) return;

                                const emailInput = document.getElementById("email");
                                const passwordInput = document.getElementById("password");
                                const errorBox = document.getElementById("error");
                                const loginButton = document.querySelector(".login-submit");

                                const email = emailInput.value.trim();
                                const password = passwordInput.value;

                                if (!email || !password) {
                                    errorBox.textContent = "Silakan masukkan email dan password.";
                                    return;
                                }

                                loginInProgress = true;
                                if (loginButton) {
                                    loginButton.disabled = true;
                                    loginButton.innerHTML = '<span>MEMERIKSA AKSES...</span><i class="fa-solid fa-spinner fa-spin"></i>';
                                }
                                errorBox.textContent = "";

                                try {
                                    await sessionReady;
                                    const credential = await signInWithEmailAndPassword(auth, email, password);

                                    // Login berhasil: bersihkan penghitung percobaan.
                                    loginAttempt = 0;
                                    sessionStorage.removeItem("madeBaliLoginAttempt");
                                    sessionStorage.removeItem("madeBaliLoginLocked");

                                    const userEmail = document.getElementById("userEmail");
                                    if (userEmail) userEmail.textContent = credential.user.email || "";

                                    document.getElementById("loginPage").style.display = "none";
                                    document.getElementById("dashboardPage").style.display = "block";
                                    startIdleTimer();

                                } catch (error) {
                                    console.error("Login gagal:", error);

                                    const credentialErrors = [
                                        "auth/invalid-credential",
                                        "auth/user-not-found",
                                        "auth/wrong-password",
                                        "auth/invalid-email"
                                    ];

                                    if (credentialErrors.includes(error.code)) {
                                        loginAttempt++;
                                        sessionStorage.setItem("madeBaliLoginAttempt", String(loginAttempt));

                                        if (loginAttempt >= 3) {
                                            showLoginLocked();
                                        } else {
                                            const remaining = 3 - loginAttempt;
                                            errorBox.textContent =
                                                `Email atau password salah. Percobaan ${loginAttempt} dari 3. Sisa kesempatan: ${remaining}.`;
                                        }
                                    } else if (error.code === "auth/too-many-requests") {
                                        errorBox.textContent =
                                            "Terlalu banyak percobaan. Firebase membatasi sementara akses ini. Silakan coba kembali nanti.";
                                    } else {
                                        errorBox.textContent =
                                            "Terjadi kesalahan saat login. Periksa koneksi internet dan coba kembali.";
                                    }

                                } finally {
                                    loginInProgress = false;
                                    if (!loginLocked && loginButton) {
                                        loginButton.disabled = false;
                                        loginButton.innerHTML = '<span>MASUK KE SISTEM</span><i class="fa-solid fa-arrow-right"></i>';
                                    }
                                }
                            }

                            async function logout() {
                                stopIdleTimer();

                                try {
                                    await signOut(auth);
                                } catch (error) {
                                    console.error("Gagal logout:", error);
                                }

                                const dashboardPage = document.getElementById("dashboardPage");
                                const loginPage = document.getElementById("loginPage");
                                if (dashboardPage) dashboardPage.style.display = "none";
                                if (loginPage) loginPage.style.display = "flex";

                                const emailInput = document.getElementById("email");
                                const passwordInput = document.getElementById("password");
                                const errorBox = document.getElementById("error");
                                if (emailInput) emailInput.value = "";
                                if (passwordInput) passwordInput.value = "";
                                if (errorBox && !loginLocked) errorBox.textContent = "";
                            }

                            // Tampilkan kondisi terkunci sejak awal, jika masih berada pada tab yang sama.
                            if (loginLocked) {
                                showLoginLocked();
                            }

                            /* ================= MASTER MENU ================= */
                            function toggleMaster() {
                                const menu = document.getElementById("masterSubMenu");
                                menu.style.display = (menu.style.display === "block") ? "none" : "block";
                            }

                            async function showMaster(type) {
                                /*====HAK AKSES MASTER DATA====*/
                                const user = auth.currentUser;

                                if (!user) {
                                    alert("Silakan login terlebih dahulu.");
                                    return;
                                }

                                const username = user.email.split("@")[0].toLowerCase().trim();
                                if (username !== "user") {
                                    alert("You do not have access to Master Data!");
                                    return;
                                }

                                /* ================= SATUAN ================= */
                                currentMaster = type;
                                let html = "";

                                if (type === "satuan") {
                                    html = `
        <h5 class="mb-3 text-warning">
          <i class="fa-solid fa-sliders"></i>
            Unit Master Data
        </h5>
        <div class="section-divider"></div>
        <div class="row mb-3">
             <div class="col-md-4">
                    <label>UOM Code</label>
                        <input type="text"
                        id="units"
                        class="form-control auto-field" readonly>
                    </div>
            <div class="col-md-4">
                <label>UOM Name</label>
                <input type="text"
                    id="unitName"
                    class="form-control"
                    placeholder="Example : Kg, Gram, Pcs, Liter">
            </div>
            <div class="col-md-4">
                <label>Submit</label>
                <button class="btn btn-warning w-100"
                    onclick="addUnit()">
                    Submit UOM
                </button>
            </div>
        </div>
        <table class="table table-dark table-striped">
            <thead>
                <tr>
                    <th>UOM Code</th>
                    <th>UOM Name</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody id="unitList"></tbody>
        </table>
        `;
                                }


                                /* ================= BAHAN BAKU ================= */
                                if (type === "bahan") {
                                    html = `
        <h5 class="mb-3 text-warning">
             <i class="fa-solid fa-boxes-stacked"></i>     
            Master of Raw Materials
                </h5>
                 <div class="section-divider"></div>
        <div class="row mb-3">
             <div class="col-md-2">
                    <label>MAT Code</label>
                        <input type="text"
                        id="materials"
                        class="form-control auto-field" readonly>
                    </div>
            <div class="col-md-3">
                <label>Raw Material</label>
                <input type="text"
                    id="materialName"
                    class="form-control mb-2"
                    placeholder="Input Raw Material">
            </div>
            <div class="col-md-2">
                <label>UOM / Units</label>
                <select id="materialUnit"
                    class="form-control mb-2">
                    <option value="">Select UOM</option>
                </select>
            </div>
            <div class="col-md-2">
                <label>Weight/Satuan</label>
                <input type="number"
                    id="materialWeight"
                    class="form-control mb-2"
                    placeholder="Weight">
            </div>
            <div class="col-md-3">
                <label>Purchase Price</label>
                <input type="number"
                    id="materialPrice"
                    class="form-control mb-2"
                    placeholder="Input Purchase Price">
            </div>
        </div>
        <button class="btn btn-warning w-100 mb-3"
            onclick="addMaterial()">
            Save Raw Materials
        </button>
        <table class="table table-dark table-striped">
           <thead>
            <tr>
                <th>Materials Code</th>
                <th>Raw Material</th>
                <th>UOM/Unit</th>
                <th>Weight</th>
                <th>Purchase Price</th>
                <th>Average</th>
                <th>Action</th>
            </tr>
        </thead>
            <tbody id="materialList"></tbody>
        </table>
        `;
                                }
                                document.getElementById("masterContent").innerHTML = html;
                                showPage('masterdata');
                                loadAll();

                                /* KHUSUS MENU SATUAN */
                                if (type === "satuan") {
                                    await setNextUnitCode();
                                }
                                /* KHUSUS MENU SATUAN */
                                if (type === "supplier") {
                                    await setNextSupCode();
                                }

                                /* KHUSUS MENU BAHAN */
                                if (type === "bahan") {
                                    await setNextMaterialCode();
                                    await loadUnitOptions();

                                }
                            }

                            /* ================= UOM / UNIT DATA ================= */
                            function genCode(prefix, size, pad = 3) {
                                return prefix + String(size + 1).padStart(pad, "0");
                            }

                            /* AUTO TAMPILKAN CODE BERIKUTNYA */
                            async function setNextUnitCode() {
                                const code = await generateCode("units", "UNT");
                                const input = document.getElementById("units");
                                if (input) {
                                    input.value = code;
                                }
                            }

                            /* TAMBAH UNIT */
                            async function addUnit() {
                                const nameInput = document.getElementById("unitName");
                                const name = nameInput.value.trim();
                                if (!name) {
                                    return alert("Wajib isi");
                                }
                                try {

                                    const code = await generateCode("units", "UNT");
                                    await addDoc(collection(db, "units"), {
                                        code: code,
                                        name: name

                                    });

                                    nameInput.value = "";
                                    await loadUnits();
                                    await setNextUnitCode();
                                    alert("Data berhasil disimpan");
                                } catch (e) {
                                    console.error(e);
                                    alert("Gagal simpan data");
                                }
                            }


                            /* ================= AUTO NUMBER CODE ================= */
                            async function generateCode(collectionName, prefix) {
                                try {

                                    const snap = await getDocs(
                                        collection(db, collectionName)
                                    );

                                    if (snap.empty) {
                                        return prefix + "001";


                                    }

                                    let maxNumber = 0;
                                    snap.forEach((d) => {
                                        const data = d.data();
                                        /* PASTIKAN ADA CODE */
                                        if (data.code) {
                                            /*
                                                CONTOH:
                                                UNT001 -> 001
                                            */
                                            const numericPart = data.code.replace(prefix, "");
                                            const number = parseInt(numericPart);

                                            /* CEK VALID NUMBER */
                                            if (!isNaN(number)) {

                                                /* CARI NOMOR TERBESAR */
                                                if (number > maxNumber) {
                                                    maxNumber = number;
                                                }
                                            }
                                        }
                                    });

                                    /* NEXT NUMBER */
                                    const nextNumber = maxNumber + 1;
                                    /* FORMAT */
                                    return prefix + String(nextNumber).padStart(3, "0");
                                } catch (error) {
                                    console.error("Generate Code Error:", error);
                                    return prefix + "001";
                                }
                            }

                            /* LOAD DATA UNIT */
                            async function loadUnits() {
                                try {
                                    const q = query(
                                        collection(db, "units"),
                                        orderBy("code", "asc")
                                    );
                                    const snap = await getDocs(q);
                                    let html = "";
                                    snap.forEach((d) => {

                                        const data = d.data();

                                        html += `
            <tr>
                <td>${data.code}</td>
                <td>${data.name}</td>
                <td width="120">
                    <button
                        class="btn btn-danger btn-sm w-100"
                        onclick="deleteUnit('${d.id}')">
                        Delete
                    </button>
                </td>
            </tr>
            `;

                                    });
                                    const el = document.getElementById("unitList");
                                    if (el) {
                                        el.innerHTML = html;
                                    }
                                } catch (e) {
                                    console.error(e);

                                    // hanya alert jika user sudah login
                                    if (auth.currentUser) {
                                        alert("Gagal load data");
                                    }
                                }
                            }

                            /* HAPUS UNIT */
                            async function deleteUnit(id) {
                                const confirmDelete = confirm("Yakin andak ingin Hapus data UOM ?");
                                if (!confirmDelete) {
                                    return;
                                }
                                try {
                                    await deleteDoc(doc(db, "units", id));
                                    await loadUnits();
                                    /* UPDATE CODE BERIKUTNYA */
                                    await setNextUnitCode();
                                    alert("Data UOM berhasil dihapus");

                                } catch (e) {
                                    console.error(e);
                                    alert("Gagal hapus data");

                                }
                            }
                            /* ================= SUPPLIER ================= */
                            /* AUTO TAMPILKAN CODE BERIKUTNYA */
                            async function showSupplier() {

                                let html = `

                                      <h5 class="mb-3 text-warning">
                                          <i class="fa-solid fa-truck"></i>
                                          Master Data Supplier
                                      </h5>
                                  
                                      <div class="section-divider"></div>
                                  
                                      <div class="row mb-3">
                                  
                                          <div class="col-md-3">
                                              <label>SUP Code</label>
                                              <input type="text"
                                                  id="suppliers"
                                                  class="form-control auto-field"
                                                  readonly>
                                          </div>
                                  
                                          <div class="col-md-3">
                                              <label>Supplier Name</label>
                                              <input type="text"
                                                  id="supplierName"
                                                  class="form-control mb-2">
                                          </div>
                                  
                                          <div class="col-md-3">
                                              <label>Supplier Address</label>
                                              <input type="text"
                                                  id="supplierAddress"
                                                  class="form-control mb-2">
                                          </div>
                                  
                                          <div class="col-md-3">
                                              <label>Contact</label>
                                              <input type="text"
                                                  id="supplierPhone"
                                                  class="form-control mb-2">
                                          </div>
                                  
                                      </div>
                                  
                                      <button class="btn btn-warning w-100 mb-3"
                                          onclick="addSupplier()">
                                          Save Supplier
                                      </button>
                                  
                                  
                                      <table class="table table-dark table-striped">
                                  
                                          <thead>
                                              <tr>
                                                  <th>Supplier Code</th>
                                                  <th>Supplier Name</th>
                                                  <th>Address</th>
                                                  <th>Contact</th>
                                                  <th>Action</th>
                                              </tr>
                                          </thead>
                                  
                                          <tbody id="supplierList"></tbody>
                                  
                                      </table>
                                      `;

                                document.getElementById("masterContent").innerHTML = html;
                                showPage('masterdata');
                                await loadSuppliers();
                                await setNextSupCode();
                            }
                            async function setNextSupCode() {
                                const code = await generateCode("suppliers", "SUP");
                                const input = document.getElementById("suppliers");

                                if (input) {
                                    input.value = code;
                                }
                            }
                            async function addSupplier() {
                                const name = document.getElementById("supplierName").value;
                                const address = document.getElementById("supplierAddress").value;
                                const phone = document.getElementById("supplierPhone").value;
                                if (!name || !address || !phone) {
                                    alert("Lengkapi data supplier");
                                    return;
                                }
                                // ambil jumlah data supplier
                                const q = query(
                                    collection(db, "suppliers"),
                                    orderBy("code", "asc")
                                );

                                const snap = await getDocs(q);
                                // generate kode otomatis
                                const code = await generateCode("suppliers", "SUP");
                                await addDoc(collection(db, "suppliers"), {
                                    code,
                                    name,
                                    address,
                                    phone

                                });

                                /* TAMPILKAN CODE BERIKUTNYA */
                                await setNextSupCode();

                                // reset form
                                document.getElementById("supplierName").value = "";
                                document.getElementById("supplierAddress").value = "";
                                document.getElementById("supplierPhone").value = "";
                                loadSuppliers();
                                alert("Supplier berhasil disimpan");
                            }
                            async function loadSuppliers() {
                                const q = query(
                                    collection(db, "suppliers"),
                                    orderBy("code", "asc")
                                );

                                const snap = await getDocs(q);
                                let html = "";
                                snap.forEach(d => {
                                    html += `
        <tr>
            <td>${d.data().code}</td>
            <td>${d.data().name}</td>
            <td>${d.data().address}</td>
            <td>${d.data().phone}</td>
            <td width="120">
                <button
                    class="btn btn-danger btn-sm w-100"
                    onclick="deleteSupplier('${d.id}')">
                    Delete
                </button>
            </td>
        </tr>
        `;
                                });

                                const el = document.getElementById("supplierList");
                                if (el) el.innerHTML = html;
                            }

                            async function deleteSupplier(id) {
                                const confirmDelete = confirm("Yakin anda akan Hapus data supplier ini ?");
                                if (!confirmDelete) return;
                                await deleteDoc(doc(db, "suppliers", id));

                                loadSuppliers();
                                await setNextSupCode();
                                alert("Supplier berhasil dihapus");
                            }

                            /* ================= RAW MATERIAL DATA ================= */
                            /* AUTO TAMPILKAN CODE BERIKUTNYA */
                            async function setNextMaterialCode() {
                                const code = await generateCode("materials", "MAT");
                                const input = document.getElementById("materials");

                                if (input) {
                                    input.value = code;
                                }
                            }

                            async function addMaterial() {
                                const name = document.getElementById("materialName").value;
                                const unit = document.getElementById("materialUnit").value;
                                const weight = document.getElementById("materialWeight").value;
                                const price = document.getElementById("materialPrice").value;

                                if (!name || !unit || !weight || !price) {
                                    alert("Lengkapi data bahan");
                                    return;
                                }

                                // hitung average
                                const average = Number(price) / Number(weight);

                                // generate kode
                                const code = await generateCode("materials", "MAT");

                                await addDoc(collection(db, "materials"), {
                                    code,
                                    name,
                                    unit,
                                    weight,
                                    price,
                                    average,
                                    createdAt: serverTimestamp()
                                });

                                /* TAMPILKAN CODE BERIKUTNYA */
                                await setNextMaterialCode();

                                // reset form
                                document.getElementById("materialName").value = "";
                                document.getElementById("materialWeight").value = "";
                                document.getElementById("materialPrice").value = "";
                                document.getElementById("materialUnit").value = "";

                                loadMaterials();

                                alert("Bahan berhasil disimpan");
                            }

                            async function loadMaterials() {
                                const q = query(
                                    collection(db, "materials"),
                                    orderBy("code", "asc")
                                );

                                const snap = await getDocs(q);
                                let html = "";
                                snap.forEach(d => {

                                    html += `
    <tr>
        <td>${d.data().code}</td>
        <td>${d.data().name}</td>
        <td>${d.data().unit}</td>
        <td> ${formatWeight(d.data().weight || 0)}</td>
        <td>Rp ${formatNumber(d.data().price || 0)}</td>
        <td>Rp ${formatNumber(d.data().average || 0)}</td>
        <td width="120">
            <button
                class="btn btn-danger btn-sm w-100"
                onclick="deleteMaterial('${d.id}')">
                Delete
            </button>
        </td>
    </tr>
    `;
                                });

                                const el = document.getElementById("materialList");
                                if (el) el.innerHTML = html;
                            }

                            async function deleteMaterial(id) {
                                const confirmDelete = confirm("Yakin anda akan Hapus data bahan baku ini ?");
                                if (!confirmDelete) return;

                                await deleteDoc(doc(db, "materials", id));
                                await setNextMaterialCode();

                                loadMaterials();
                                alert("Bahan berhasil dihapus");
                            }

                            async function loadUnitOptions() {
                                const q = query(
                                    collection(db, "units"),
                                    orderBy("code", "asc")
                                );

                                const snap = await getDocs(q);
                                let html = `<option value="">Select UOM</option>`;
                                snap.forEach(d => {
                                    html += `
        <option value="${d.data().name}">
            ${d.data().name}
        </option>
        `;
                                });

                                const el = document.getElementById("materialUnit");
                                if (el) el.innerHTML = html;
                            }

                            /* ================= RECIPE ================= */
                            async function showProductionRecipe() {

                                /* ==LOCK ACCES INPUT DATA==== */
                                const user = auth.currentUser;
                                if (!user) return;
                                const username = user.email.split("@")[0].toLowerCase().trim();

                                if (username !== "user") {
                                    alert("You do not have access to Master Data!");
                                    return;
                                }

                                showPage('forecastproduk');
                                recipeItems = [];
                                document.getElementById("recipeTable").innerHTML = "";
                                // generate kode otomatis
                                const q = query(
                                    collection(db, "products"),
                                    orderBy("code", "asc")
                                );

                                const snap = await getDocs(q);
                                const code = genCode("PKMB", snap.size);
                                document.getElementById("recipeCode").value = code;
                                loadRecipeMaterials();
                                loadRecipeUnits();

                                document.getElementById("recipeMaterial").addEventListener("change", calculateRecipePrice);
                                document.getElementById("recipeQty").addEventListener("input", calculateRecipePrice);

                                loadForecast();
                            }

                            async function loadRecipeMaterials() {
                                const q = query(
                                    collection(db, "materials"),
                                    orderBy("code", "asc")
                                );

                                const snap = await getDocs(q);
                                let html = "";
                                snap.forEach(d => {

                                    html += `
        <option value="${d.data().name}">
            ${d.data().name}
        </option>
        `;
                                });

                                document.getElementById("recipeMaterial").innerHTML = html;
                            }
                            async function loadRecipeUnits() {
                                const q = query(
                                    collection(db, "units"),
                                    orderBy("code", "asc")
                                );
                                const snap = await getDocs(q);
                                let html = "";
                                snap.forEach(d => {
                                    html += `
        <option value="${d.data().name}">
            ${d.data().name}
        </option>
        `;
                                });

                                document.getElementById("recipeUnit").innerHTML = html;
                            }

                            async function calculateRecipePrice() {
                                const material =
                                    document.getElementById("recipeMaterial").value;
                                const qty =
                                    Number(document.getElementById("recipeQty").value || 0);

                                if (!material || qty <= 0) {
                                    document.getElementById("recipePrice").value = "";
                                    return;
                                }

                                const materialSnap =
                                    await getDocs(collection(db, "materials"));

                                let average = 0;
                                materialSnap.forEach(mat => {

                                    const m = mat.data();

                                    if (
                                        m.name?.toLowerCase().trim() ===
                                        material.toLowerCase().trim()
                                    ) {
                                        average = Number(m.average || 0);
                                    }

                                });
                                const totalPrice = qty * average;
                                document.getElementById("recipePrice").value =
                                    totalPrice.toLocaleString("id-ID");
                            }

                            async function addRecipeItem() {
                                const material = document.getElementById("recipeMaterial").value;
                                const qty = Number(document.getElementById("recipeQty").value);
                                const unit = document.getElementById("recipeUnit").value;

                                if (!material || !qty || !unit) {
                                    alert("Lengkapi data bahan");
                                    return;
                                }

                                // cari average material
                                const materialSnap =
                                    await getDocs(collection(db, "materials"));

                                let materialPrice = 0;
                                materialSnap.forEach(mat => {
                                    const m = mat.data();
                                    if (
                                        m.name?.toLowerCase().trim() ===
                                        material.toLowerCase().trim()
                                    ) {
                                        materialPrice = Number(m.average || 0);
                                    }
                                });

                                const totalPrice = qty * materialPrice;
                                recipeItems.push({
                                    material,
                                    qty,
                                    unit,
                                    price: totalPrice
                                });

                                document.getElementById("recipeQty").value = "";
                                document.getElementById("recipePrice").value = "";
                                renderRecipeTable();
                            }

                            function renderRecipeTable() {

                                let html = "";
                                let grandTotal = 0;

                                recipeItems.forEach((item, index) => {

                                    grandTotal += Number(item.price || 0);

                                    html += `
        <tr>
            <td>${item.material}</td>
            <td>${item.qty}</td>
            <td>${item.unit}</td>
            <td>Rp ${Number(item.price || 0).toLocaleString()}</td>
            <td width="120">
                <button class="btn btn-danger btn-sm"
                    onclick="deleteRecipeItem(${index})">
                    Delete
                </button>
            </td>
        </tr>
        `;
                                });

                                document.getElementById("recipeTable").innerHTML = html;
                                document.getElementById("priceForecaseTotal").innerHTML =
                                    `Rp ${grandTotal.toLocaleString()}`;
                            }

                            async function saveRecipe() {
                                const code = document.getElementById("recipeCode").value;
                                const name = document.getElementById("recipeProductName").value;
                                if (!name) {

                                    alert("Nama produk wajib diisi");

                                    return;
                                }
                                // save produk
                                await addDoc(collection(db, "products"), {
                                    code,
                                    name,
                                    createdAt: serverTimestamp()
                                });

                                // save detail recipe
                                for (const item of recipeItems) {

                                    await addDoc(collection(db, "product_recipes"), {
                                        productCode: code,
                                        productName: name,
                                        material: item.material,
                                        qty: item.qty,
                                        unit: item.unit,
                                        createdAt: serverTimestamp()
                                    });
                                }

                                alert("Forecast produk berhasil disimpan");

                                // reset form
                                recipeItems = [];

                                // refresh tabel input bahan
                                renderRecipeTable();

                                document.getElementById("recipeProductName").value = "";
                                document.getElementById("recipeQty").value = "";

                                // reload data forecast
                                loadForecast();
                            }

                            async function loadForecast() {
                                const productSnap = await getDocs(
                                    query(collection(db, "products"), orderBy("code", "asc"))
                                );
                                const recipeSnap = await getDocs(
                                    collection(db, "product_recipes")
                                );

                                const materialSnap = await getDocs(
                                    collection(db, "materials")
                                );

                                const recipes = recipeSnap.docs.map(d => d.data());
                                let html = "";

                                for (const productDoc of productSnap.docs) {
                                    const product = productDoc.data();
                                    const productRecipes = recipes.filter(
                                        r => r.productCode === product.code
                                    );

                                    const count = productRecipes.length;
                                    let totalCost = 0;
                                    productRecipes.forEach(r => {
                                        let materialPrice = 0;
                                        materialSnap.forEach(mat => {
                                            const m = mat.data();

                                            if (
                                                m.name?.toLowerCase().trim() ===
                                                r.material?.toLowerCase().trim()
                                            ) {
                                                materialPrice = Number(m.average || 0);
                                            }

                                        });

                                        const qty = Number(r.qty || 0);
                                        totalCost += qty * materialPrice;

                                    });

                                    html += `
    <tr>
        <td>${product.code}</td>
        <td>${product.name}</td>
        <td>${count} bahan</td>
        <td>Rp ${formatNumber(totalCost)}</td>
        <td>
            <button class="btn btn-info btn-sm"
                onclick="viewForecast('${product.code}')">
                Detail
            </button>

            <button class="btn btn-danger btn-sm"
                onclick="deleteForecast('${product.code}')">
                Delete
            </button>
        </td>
    </tr>
    `;
                                }

                                const el = document.getElementById("forecastList");
                                if (el) el.innerHTML = html;
                            }

                            window.deleteForecast = async function (code) {
                                const confirmDelete = confirm(
                                    "Yakin ingin menghapus forecast ini?"
                                );
                                if (!confirmDelete) return;
                                try {

                                    // hapus product
                                    const productSnap = await getDocs(
                                        query(
                                            collection(db, "products"),
                                            where("code", "==", code)
                                        )
                                    );
                                    for (const docItem of productSnap.docs) {
                                        await deleteDoc(doc(db, "products", docItem.id));
                                    }

                                    // hapus recipe terkait
                                    const recipeSnap = await getDocs(
                                        query(
                                            collection(db, "product_recipes"),
                                            where("productCode", "==", code)
                                        )
                                    );
                                    for (const docItem of recipeSnap.docs) {
                                        await deleteDoc(doc(db, "product_recipes", docItem.id));
                                    }
                                    alert("Forecast berhasil dihapus");
                                    loadForecast();
                                } catch (err) {

                                    console.error(err);
                                    alert("Gagal menghapus forecast");
                                }
                            }

                            async function viewForecast(code) {
                                forecastSource = "forecast";
                                showPage('forecastdetail');
                                // ambil produk
                                const productSnap = await getDocs(collection(db, "products"));
                                let productName = "";
                                productSnap.forEach(d => {

                                    if (d.data().code === code) {
                                        productName = d.data().name;
                                    }
                                });

                                document.getElementById("forecastTitle").innerHTML =
                                    `Forecast Produk : ${productName}`;
                                // ambil recipe
                                const recipeSnap =
                                    await getDocs(collection(db, "product_recipes"));
                                // ambil bahan baku
                                const materialSnap =
                                    await getDocs(collection(db, "materials"));

                                let grandTotal = 0;
                                let rows = [];
                                recipeSnap.forEach(recipe => {
                                    const r = recipe.data();
                                    if (r.productCode === code) {
                                        let materialCode = "";
                                        let materialPrice = 0;
                                        materialSnap.forEach(mat => {
                                            const m = mat.data();

                                            if (
                                                m.name?.toLowerCase().trim() ===
                                                r.material?.toLowerCase().trim()
                                            ) {
                                                materialCode = m.code;
                                                materialPrice = Number(m.average || 0);
                                            }
                                        });

                                        const qty = Number(r.qty || 0);
                                        const totalPrice = qty * materialPrice;
                                        grandTotal += totalPrice;
                                        rows.push({
                                            code: materialCode || "UNKNOWN",
                                            html: `
<tr>
    <td>${materialCode}</td>
    <td>${r.material}</td>
    <td>${qty}</td>
    <td>${r.unit}</td>
    <td>Rp ${formatNumber(totalPrice || 0)}</td>
</tr>
`
                                        });
                                    }
                                });

                                rows.sort((a, b) =>
                                    (a.code || "").localeCompare(b.code || "")
                                );

                                let html = "";
                                rows.forEach(r => html += r.html);

                                document.getElementById("forecastDetailTable").innerHTML = html;
                                document.getElementById("forecastTotal").innerHTML =
                                    `Rp ${formatNumber(grandTotal || 0)}`;
                            }

                            function backForecast() {
                                if (forecastSource === "produksi") {
                                    showPage("produksi");
                                } else {
                                    showPage("forecastproduk");
                                }
                            }


                            /* =========================================================
                                PRICE FG
                                ========================================================= */
                            /* ================= OPEN PAGE ================= */
                            async function showPriceProduct() {

                                /* ========LOCK ACCESS INPUT DATA========== */
                                const user = auth.currentUser;
                                if (!user) return;
                                const username = user.email.split("@")[0].toLowerCase().trim();
                                if (username !== "user") {
                                    alert("You do not have access to Master Data!");
                                    return;
                                }

                                showPage("pricefg");
                                await loadPriceFGProducts();
                                await loadPriceFGMaterials();
                                await loadPriceFGPlastic();
                                await loadPriceFGTable();
                            }

                            /* ================= LOAD PRODUCT ================= */
                            async function loadPriceFGProducts() {
                                const select =
                                    document.getElementById("priceFgProduct");
                                if (!select) return;
                                const snap = await getDocs(
                                    query(
                                        collection(db, "products"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let html = `
        <option value="">
            Select Product
        </option>
    `;

                                snap.forEach(d => {
                                    const data = d.data();
                                    html += `
            <option value="${data.code}">
                ${data.code} - ${data.name}
            </option>
        `;
                                });

                                select.innerHTML = html;
                            }

                            async function loadPriceFGMaterials() {
                                const select =
                                    document.getElementById("priceFgMaterial");
                                console.log("SELECT =", select);
                                if (!select) return;
                                const snap = await getDocs(
                                    query(
                                        collection(db, "materials"),
                                        orderBy("code", "asc")
                                    )
                                );
                                console.log("TOTAL MATERIAL =", snap.size);
                                let html = `
        <option value="">
            Select Box product
        </option>
    `;

                                snap.forEach(d => {
                                    console.log(d.data());
                                    const data = d.data();
                                    html += `
            <option
                value="${d.id}"
                data-name="${data.name}"
                data-price="${Number(data.average || 0)}">
                ${data.code} - ${data.name}
            </option>
        `;
                                });

                                select.innerHTML = html;
                            }

                            async function loadPriceFGPlastic() {
                                const select =
                                    document.getElementById("priceFgPlastic");
                                if (!select) return;
                                const snap = await getDocs(
                                    query(
                                        collection(db, "materials"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let html = `
        <option value="">
            Select Plastic Srink
        </option>
    `;

                                snap.forEach(d => {
                                    const data = d.data();
                                    html += `
            <option
                value="${d.id}"
                data-name="${data.name}"
                data-price="${Number(data.average || 0)}">
                ${data.code} - ${data.name}

            </option>
        `;
                                });
                                select.innerHTML = html;
                            }
                            async function calculatePriceFG() {
                                const productCode =
                                    document.getElementById("priceFgProduct").value;
                                const materialSelect =
                                    document.getElementById("priceFgMaterial");

                                let forecastHpp = 0;
                                if (productCode) {
                                    const recipeSnap =
                                        await getDocs(
                                            collection(db, "product_recipes")
                                        );
                                    const materialSnap =
                                        await getDocs(
                                            collection(db, "materials")
                                        );
                                    recipeSnap.forEach(recipe => {
                                        const r = recipe.data();
                                        if (r.productCode === productCode) {
                                            let avg = 0;
                                            materialSnap.forEach(mat => {
                                                const m = mat.data();
                                                if (
                                                    m.name?.toLowerCase().trim() ===
                                                    r.material?.toLowerCase().trim()
                                                ) {
                                                    avg = Number(m.average || 0);
                                                }
                                            });

                                            forecastHpp +=
                                                Number(r.qty || 0) * avg;
                                        }
                                    });
                                }

                                document.getElementById("priceFgForecastHpp").value = formatNumber(forecastHpp);

                                let materialPrice = 0;
                                if (materialSelect.value) {
                                    const selected =
                                        materialSelect.options[
                                        materialSelect.selectedIndex
                                        ];
                                    materialPrice =
                                        Number(
                                            selected.getAttribute("data-price")
                                        ) || 0;
                                }

                                document.getElementById("priceFgMaterialPrice").value = formatNumber(materialPrice);

                                const qtyPerBox = Number(document.getElementById("priceFgQtyBox").value) || 0;
                                const forecastBox = forecastHpp * qtyPerBox;

                                document.getElementById("priceFgForecastBox").value = formatNumber(forecastBox);

                                let plasticPrice = 0;

                                const plasticSelect = document.getElementById("priceFgPlastic");
                                if (plasticSelect && plasticSelect.value) {
                                    const selected =
                                        plasticSelect.options[
                                        plasticSelect.selectedIndex
                                        ];
                                    plasticPrice =
                                        Number(
                                            selected.getAttribute("data-price")
                                        ) || 0;
                                }

                                document.getElementById("priceFgPlasticPrice").value = formatNumber(plasticPrice);

                                const totalHpp = forecastBox + materialPrice + plasticPrice;
                                document.getElementById("priceFgTotalHpp").value = formatNumber(totalHpp);
                            }

                            /* ================= SAVE PRICE ================= */
                            async function savePriceFG() {
                                const productCode = document.getElementById("priceFgProduct").value;
                                const qtyPerBox = Number(document.getElementById("priceFgQtyBox").value);
                                const price = Number(document.getElementById("priceFgPrice").value);
                                const priceStore = Number(document.getElementById("priceFgPriceStore").value);
                                const materialSelect = document.getElementById("priceFgMaterial");
                                const materialName =
                                    materialSelect.value
                                        ? materialSelect.options[
                                            materialSelect.selectedIndex
                                        ].getAttribute("data-name")
                                        : "";
                                const materialPrice =
                                    materialSelect.value
                                        ? Number(
                                            materialSelect.options[
                                                materialSelect.selectedIndex
                                            ].getAttribute("data-price")
                                        )
                                        : 0;
                                const plasticSelect =
                                    document.getElementById("priceFgPlastic");
                                const plasticName =
                                    plasticSelect.value
                                        ? plasticSelect.options[
                                            plasticSelect.selectedIndex
                                        ].getAttribute("data-name")
                                        : "";
                                const plasticPrice =
                                    plasticSelect.value
                                        ? Number(
                                            plasticSelect.options[
                                                plasticSelect.selectedIndex
                                            ].getAttribute("data-price")
                                        )
                                        : 0;

                                const hppForecast = parseNumberID(document.getElementById("priceFgForecastHpp").value);
                                const hppTotal = parseNumberID(document.getElementById("priceFgTotalHpp").value);
                                if (
                                    !productCode ||
                                    !qtyPerBox ||
                                    !price
                                ) {

                                    alert("Lengkapi data");
                                    return;
                                }
                                /* ================= PRODUCT NAME ================= */
                                let productName = "";
                                const productSnap =
                                    await getDocs(collection(db, "products"));
                                productSnap.forEach(d => {
                                    const data = d.data();
                                    if (data.code === productCode) {
                                        productName = data.name;
                                    }
                                });
                                /* ================= CHECK EXIST ================= */
                                const priceSnap =
                                    await getDocs(collection(db, "price_fg"));
                                let existingId = null;
                                priceSnap.forEach(d => {
                                    const data = d.data();
                                    if (data.productCode === productCode) {
                                        existingId = d.id;
                                    }
                                });
                                /* ================= UPDATE ================= */
                                if (existingId) {
                                    await updateDoc(
                                        doc(db, "price_fg", existingId),
                                        {
                                            qtyPerBox,
                                            price,
                                            materialName,
                                            materialPrice,
                                            hppForecast,
                                            hppTotal,
                                            updatedAt: serverTimestamp()
                                        }
                                    );

                                    alert("Harga jual berhasil diupdate");
                                }

                                /* ================= INSERT ================= */
                                else {
                                    await addDoc(
                                        collection(db, "price_fg"),
                                        {
                                            productCode,
                                            productName,
                                            qtyPerBox,
                                            materialName,
                                            materialPrice,
                                            hppForecast,
                                            hppTotal,
                                            price,
                                            priceStore,
                                            createdAt: serverTimestamp()
                                        }
                                    );

                                    alert("Harga jual berhasil disimpan");
                                }

                                /* ================= RESET ================= */
                                document.getElementById("priceFgProduct").value = "";
                                document.getElementById("priceFgQtyBox").value = "";
                                document.getElementById("priceFgPrice").value = "";
                                document.getElementById("priceFgPriceStore").value = "";
                                document.getElementById("priceFgMaterial").value = "";
                                document.getElementById("priceFgPlastic").value = "";
                                document.getElementById("priceFgForecastHpp").value = "";
                                document.getElementById("priceFgForecastBox").value = "";
                                document.getElementById("priceFgMaterialPrice").value = "";
                                document.getElementById("priceFgPlasticPrice").value = "";
                                document.getElementById("priceFgTotalHpp").value = "";

                                await loadPriceFGTable();
                            }
                            /* ================= LOAD TABLE ================= */
                            async function loadPriceFGTable() {
                                const tbody =
                                    document.getElementById("priceFGList");
                                if (!tbody) return;
                                const snap = await getDocs(
                                    query(
                                        collection(db, "price_fg"),
                                        orderBy("productCode", "asc")
                                    )
                                );

                                let html = "";
                                snap.forEach(d => {
                                    const data = d.data();
                                    html += `
                        <tr>
                            <td>${data.productCode}</td>
                            <td>${data.productName}</td>
                            <td>${data.qtyPerBox}</td>
                            <td> Rp ${formatNumber(data.hppTotal || 0)} </td>
                            <td> Rp ${formatNumber(data.price || 0)} </td>
                            <td> Rp ${formatNumber(data.priceStore || 0)} </td>
                            <td width="120">
                                <button
                                    class="btn btn-danger btn-sm w-100"
                                    onclick="deletePriceFG('${d.id}')">
                                    Delete
                                </button>
                            </td>
                        </tr>
                        `;
                                });

                                tbody.innerHTML =
                                    html ||
                                    `
                    <tr>
                        <td colspan="7">
                        <td colspan="8" class="text-center">
                            Tidak ada data
                        </td>
                    </tr>
                    `;
                            }
                            /* ================= DELETE ================= */
                            async function deletePriceFG(id) {
                                if (!confirm("Hapus harga jual produk?")) return;

                                await deleteDoc(
                                    doc(db, "price_fg", id)
                                );
                                await loadPriceFGTable();
                                alert("Harga jual berhasil dihapus");
                            }
                            /* ================= PURCHASING ================= */
                            function togglePurchasing() {
                                const menu = document.getElementById("purchasingSubMenu");
                                menu.style.display = (menu.style.display === "block") ? "none" : "block";
                            }
                            function initPurchaseFilter() {
                                const yearSelect = document.getElementById("filterYear");
                                const currentYear = new Date().getFullYear();
                                let html = "";
                                for (let year = 2025; year <= currentYear + 50; year++) {
                                    html += `<option value="${year}">${year}</option>`;
                                }
                                yearSelect.innerHTML = html;
                                document.getElementById("filterMonth").value =
                                    String(new Date().getMonth() + 1);
                                document.getElementById("filterYear").value =
                                    String(currentYear);
                            }
                            window.addEventListener("load", () => {
                                // Inisialisasi tampilan saja. Pembacaan Firestore dilakukan
                                // oleh loadAll() setelah Firebase Authentication terverifikasi.
                                initPurchaseFilter();
                            });

                            /* ================= LOAD OPTIONS ================= */
                            async function loadPurchaseOptions() {
                                // ================= MATERIAL =================
                                const materialSnap = await getDocs(
                                    query(
                                        collection(db, "materials"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let materialHtml = `<option value="">Select Materials</option>`;
                                materialSnap.forEach(d => {
                                    const data = d.data();
                                    materialHtml += `
            <option
                value="${data.code}"
                data-name="${data.name}"
                data-unit="${data.unit}">
                ${data.code} - ${data.name}
            </option>
        `;
                                });

                                document.getElementById("purchaseMaterial").innerHTML = materialHtml;

                                // ================= SUPPLIER =================
                                const supplierSnap = await getDocs(
                                    query(
                                        collection(db, "suppliers"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let supplierHtml = `<option value="">Select Supplier</option>`;
                                supplierSnap.forEach(d => {
                                    supplierHtml += `
                            <option value="${d.data().name}">
                                ${d.data().name}
                            </option>
                        `;
                                });

                                document.getElementById("purchaseSupplier").innerHTML = supplierHtml;

                                // ================= AUTO UOM =================
                                const materialSelect = document.getElementById("purchaseMaterial");
                                materialSelect.onchange = function () {
                                    const selected = this.options[this.selectedIndex];
                                    if (!selected.value) {
                                        document.getElementById("purchaseUnit").value = "";
                                        return;
                                    }
                                    document.getElementById("purchaseUnit").value =
                                        selected.dataset.unit || "";
                                };
                            }

                            /* ================= AVERAGE ================= */
                            function calculateAverage() {
                                const qty = Number(document.getElementById("purchaseQty").value);
                                const price = Number(document.getElementById("purchasePrice").value);

                                if (qty <= 0 || price <= 0) {
                                    document.getElementById("purchaseAverage").value = "";
                                    return;
                                }

                                document.getElementById("purchaseAverage").value = (price / qty).toFixed(2);
                            }

                            /* ================= SAVE ================= */
                            async function savePurchase() {
                                const materialSelect = document.getElementById("purchaseMaterial");
                                if (materialSelect.selectedIndex < 0) {
                                    alert("Pilih material");
                                    return;
                                }
                                const materialCode = materialSelect.value;
                                const materialName = materialSelect.options[materialSelect.selectedIndex].dataset.name;
                                const qty = Number(document.getElementById("purchaseQty").value);
                                const unit = document.getElementById("purchaseUnit").value;
                                const price = Number(document.getElementById("purchasePrice").value);
                                const supplier = document.getElementById("purchaseSupplier").value;
                                const date = document.getElementById("purchaseDate").value;

                                if (!materialCode || !qty || !unit || !price || !supplier || !date) {
                                    alert("Lengkapi data purchasing");
                                    return;
                                }
                                const snap = await getDocs(collection(db, "purchasing"));
                                const code = genCode("PUR", snap.size);
                                await addDoc(collection(db, "purchasing"), {

                                    materialCode,
                                    materialName,
                                    qty,
                                    unit,
                                    price,
                                    supplier,
                                    date,
                                    createdAt: serverTimestamp()
                                });

                                alert("Purchase Order Material Berhasil Disimpan");

                                document.getElementById("purchaseMaterial").value = "";
                                document.getElementById("purchaseQty").value = "";
                                document.getElementById("purchasePrice").value = "";
                                document.getElementById("purchaseUnit").value = "";
                                document.getElementById("purchaseAverage").value = "";
                                document.getElementById("purchaseSupplier").value = "";

                                await loadPurchases();
                                await loadPurchasesData();
                            }

                            /* ================= LIST TABLE ================= */
                            async function loadPurchases() {
                                console.log("loadPurchases dijalankan");
                                console.log("Month =", document.getElementById("filterMonth")?.value);
                                console.log("Year =", document.getElementById("filterYear")?.value);

                                const selectedMonth = Number(document.getElementById("filterMonth").value);
                                const selectedYear = Number(document.getElementById("filterYear").value);
                                const firstDay = new Date(
                                    selectedYear,
                                    selectedMonth - 1,
                                    1
                                );

                                const lastDay = new Date(
                                    selectedYear,
                                    selectedMonth,
                                    0
                                );

                                const startDate = firstDay.toISOString().split("T")[0];
                                const endDate = lastDay.toISOString().split("T")[0];

                                const snap = await getDocs(
                                    query(
                                        collection(db, "purchasing"),
                                        where("date", ">=", startDate),
                                        where("date", "<=", endDate),
                                        orderBy("date", "asc")
                                    )
                                );

                                let html = "";
                                let totalPurchasePrice = 0;

                                snap.forEach(d => {
                                    const item = d.data();

                                    const qty = Number(item.qty || 0);
                                    const price = Number(item.price || 0);
                                    const average = price / (qty || 1);

                                    totalPurchasePrice += price;

                                    html += `
    <tr>
        <td>${item.materialCode}</td>
        <td>${item.materialName}</td>
        <td>${qty}</td>
        <td>${item.unit}</td>
        <td>Rp ${formatNumber(price)}</td>
        <td>Rp ${formatNumber(average)}</td>
        <td>${item.supplier}</td>
        <td>${item.date}</td>
        <td>
            <button class="btn btn-danger btn-sm"
                onclick="deletePurchase('${d.id}')">
                Delete
            </button>
        </td>
    </tr>
    `;
                                });

                                document.getElementById("purchaseList").innerHTML =
                                    html || "<tr><td colspan='9'>Tidak ada data</td></tr>";

                                document.getElementById("totalPurchaseAmount").innerHTML =
                                    `Rp ${formatNumber(totalPurchasePrice)}`;
                            }

                            /* ================= DELETE ================= */
                            async function deletePurchase(id) {
                                if (!confirm("Hapus purchasing?")) return;

                                await deleteDoc(doc(db, "purchasing", id));
                                await loadPurchases();
                                await loadPurchasesData();

                                alert("Berhasil dihapus");
                            }

                            /* ================= VIEW DATA PURCHASING ================= */
                            async function loadPurchasesData() {
                                const startDate =
                                    document.getElementById("filterStartDate").value;
                                const endDate =
                                    document.getElementById("filterEndDate").value;
                                let q;

                                // FILTER TANGGAL
                                if (startDate && endDate) {
                                    q = query(
                                        collection(db, "purchasing"),
                                        where("date", ">=", startDate),
                                        where("date", "<=", endDate),
                                        orderBy("date", "asc")
                                    );

                                } else {

                                    q = query(
                                        collection(db, "purchasing"),
                                        orderBy("date", "asc")
                                    );
                                }

                                const snap = await getDocs(q);
                                let html = "";
                                let grandTotal = 0;
                                snap.forEach(d => {

                                    const item = d.data();
                                    const qty = Number(item.qty || 0);
                                    const price = Number(item.price || 0);
                                    const average = price / (qty || 1);
                                    grandTotal += price;

                                    html += `
            <tr>
                <td>${item.materialCode}</td>
                <td>${item.materialName}</td>
                <td>${qty}</td>
                <td>${item.unit}</td>
                <td>Rp ${formatNumber(price)}</td>
                <td>Rp ${formatNumber(average)}</td>
                <td>${item.supplier}</td>
                <td>${item.date}</td>
            </tr>
        `;
                                });

                                // TOTAL HARGA BELI
                                document.getElementById("totalPurchasePrice").innerHTML =
                                    `Rp ${formatNumber(grandTotal)}`;

                                // TABLE
                                document.getElementById("purchaseViewList").innerHTML =
                                    html || `
            <tr>
                <td colspan="8" class="text-center">
                    Tidak ada data
                </td>
            </tr>
        `;
                            }
                            window.addEventListener("load", () => {
                                const today = new Date().toISOString().split("T")[0];
                                document.getElementById("filterStartDate").value = today;
                                document.getElementById("filterEndDate").value = today;

                            });

                            /* ================= EXPORT PURCHASE PDF ================= */
                            async function printPurchasePDF() {

                                // ================= JSPDF =================
                                const { jsPDF } = window.jspdf;

                                // PDF
                                const doc = new jsPDF(
                                    "landscape",
                                    "pt",
                                    "a4"
                                );

                                // ================= FILTER TANGGAL =================
                                const startDate =
                                    document.getElementById("filterStartDate").value;
                                const endDate =
                                    document.getElementById("filterEndDate").value;

                                let q;

                                // ================= QUERY =================
                                if (startDate && endDate) {

                                    q = query(
                                        collection(db, "purchasing"),
                                        where("date", ">=", startDate),
                                        where("date", "<=", endDate),
                                        orderBy("date", "asc")
                                    );

                                } else {

                                    q = query(
                                        collection(db, "purchasing"),
                                        orderBy("date", "desc")
                                    );
                                }

                                // ================= GET DATA =================
                                const snap = await getDocs(q);

                                // ================= CEK DATA =================
                                if (snap.empty) {
                                    alert("Data purchasing kosong");
                                    return;
                                }

                                // ================= FORMAT PRINT DATE =================
                                const today = new Date();

                                const printDate =
                                    today.getDate().toString().padStart(2, "0") + "/" +
                                    (today.getMonth() + 1).toString().padStart(2, "0") + "/" +
                                    today.getFullYear();

                                // ================= TOTAL =================
                                let totalPrice = 0;

                                // ================= TABLE ROW =================
                                const rows = [];
                                let no = 1;
                                snap.forEach(d => {
                                    const item = d.data();
                                    const qty = Number(item.qty || 0);
                                    const price = Number(item.price || 0);
                                    const average = price / (qty || 1);
                                    totalPrice += price;
                                    rows.push([
                                        no++,
                                        item.materialCode,
                                        item.materialName,
                                        qty,
                                        item.unit,
                                        "Rp " + formatNumber(price),
                                        "Rp " + formatNumber(average),
                                        item.supplier,
                                        item.date
                                    ]);
                                });

                                // ================= HEADER =================
                                doc.setFontSize(16);
                                doc.text(
                                    "LIST DETAIL PURCHASE ORDER",
                                    40,
                                    40
                                );

                                // ================= PERIODE =================
                                doc.setFontSize(11);
                                doc.text(
                                    `PERIODE ${startDate || "-"} S.D ${endDate || "-"}`,
                                    40,
                                    60
                                );

                                // ================= PRINT DATE =================
                                doc.text(
                                    `Print Date : ${printDate}`,
                                    650,
                                    60
                                );

                                // ================= TOTAL HARGA BELI =================
                                doc.setFontSize(12);
                                doc.text(
                                    `Total Purchase Order : Rp ${formatNumber(totalPrice)}`,
                                    40,
                                    80
                                );

                                // ================= TABLE PDF =================
                                doc.autoTable({
                                    startY: 100,
                                    head: [[
                                        "No",
                                        "Kode",
                                        "Material Name",
                                        "Qty",
                                        "UOM",
                                        "Purchase Price",
                                        "Average",
                                        "Supplier",
                                        "Purchase Date"
                                    ]],

                                    body: rows,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 9
                                    },
                                    headStyles: {
                                        fillColor: [255, 193, 7]
                                    }
                                });

                                // ================= NAMA FILE PDF =================
                                let fileName = "Purchase Order";

                                const bulan = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];

                                if (startDate && endDate) {

                                    // Format input date = YYYY-MM-DD
                                    const [startYear, startMonth, startDay] = startDate.split("-");
                                    const [endYear, endMonth, endDay] = endDate.split("-");

                                    // Jika bulan & tahun sama
                                    if (startMonth === endMonth && startYear === endYear) {

                                        fileName += ` ${bulan[parseInt(startMonth, 10) - 1]} ${startYear}`;

                                    }

                                    // Jika tahun sama tetapi beda bulan
                                    else if (startYear === endYear) {

                                        fileName += ` ${bulan[parseInt(startMonth, 10) - 1]} - ${bulan[parseInt(endMonth, 10) - 1]} ${startYear}`;

                                    }

                                    // Jika beda tahun
                                    else {

                                        fileName += ` ${startDay}-${startMonth}-${startYear}`;
                                        fileName += ` s.d. `;
                                        fileName += `${endDay}-${endMonth}-${endYear}`;

                                    }

                                } else {

                                    // Jika tidak memakai filter
                                    const today = new Date();

                                    fileName += ` ${bulan[today.getMonth()]} ${today.getFullYear()}`;
                                }

                                // ================= SAVE PDF =================
                                doc.save(`${fileName}.pdf`);
                            }

                            // ================= GLOBAL =================
                            window.printPurchasePDF = printPurchasePDF;

                            /* ================= PRODUKSI ================= */
                            function toggleProduksi() {
                                const menu = document.getElementById("produksiSubMenu");
                                menu.style.display = (menu.style.display === "block") ? "none" : "block";
                            }

                            function showProduksi(type) {

                                document.querySelectorAll(".produksi-subpage")
                                    .forEach(el => el.style.display = "none");

                                let targetId = "";

                                /* ================= INPUT PRODUKSI ================= */
                                if (type === "input") {
                                    targetId = "produksi_input";
                                    document.getElementById(targetId).innerHTML = `
            <h4 class="text-warning">Input Produksi</h4>

            <div class="row">
                <div class="col-md-4">
                    <label>Produk</label>
                    <select id="prodProduct" class="form-control"></select>
                </div>

                <div class="col-md-3">
                    <label>Qty Produksi</label>
                    <input type="number" id="prodQty" class="form-control">
                </div>

                <div class="col-md-3">
                    <label>Tanggal</label>
                    <input type="date" id="prodDate" class="form-control">
                </div>

                <div class="col-md-2 d-flex align-items-end">
                    <button class="btn btn-warning w-100" onclick="saveProduction()">
                        Simpan
                    </button>
                </div>
            </div>
        `;

                                    requestAnimationFrame(() => {
                                        loadProductionProducts();

                                        initProductionFilter();

                                        const select = document.getElementById("produksi_input");
                                        if (select) select.innerHTML = html;
                                        loadProductionList();
                                    });
                                }
                                /* ================= HASIL PRODUKSI ================= */
                                if (type === "hasil") {

                                    targetId = "produksi_hasil";

                                    document.getElementById(targetId).innerHTML = `
            <h4>Hasil Produksi</h4>
            <div class="row mb-3">
                <div class="col-md-3">
                    <label>Produk</label>
                    <select id="resProduct" class="form-control"></select>
                </div>
                <div class="col-md-2">
                    <label>FG PCS</label>
                    <input type="number" id="resFgPcs" class="form-control">
                </div>
                <div class="col-md-2">
                    <label>FG BOX</label>
                    <input type="number" id="resFgBox" class="form-control">
                </div>
                <div class="col-md-3">
                    <label>Tanggal</label>
                    <input type="date" id="resDate" class="form-control">
                </div>
                <div class="col-md-2 d-flex align-items-end">
                    <button class="btn btn-warning w-100" onclick="saveProductionResult()">
                        Save
                    </button>
                </div>
            </div>

            <table class="table table-dark table-striped">
                <thead>
                    <tr>
                        <th>Kode Produk</th>
                        <th>Nama Produk</th>
                        <th>FG PCS</th>
                        <th>FG BOX</th>
                        <th>Tanggal</th>
                        <th>Aksi</th>
                    </tr>
                </thead>
                <tbody id="productionResultList"></tbody>
            </table>
        `;

                                    setTimeout(async () => {
                                        await loadProductionOrdersToResultSelect();
                                        await loadProductionResult();
                                    }, 150);
                                }

                                /* ================= WASTE FG ================= */
                                if (type === "waste_fg") {
                                    targetId = "produksi_waste_fg";
                                    document.getElementById(targetId).innerHTML = `
            <h4>Waste Finished Goods</h4>
            <table class="table table-dark table-striped">
                <thead>
                    <tr>
                        <th>Produk</th>
                        <th>Qty Waste</th>
                        <th>Keterangan</th>
                    </tr>
                </thead>
                <tbody id="wasteFGList"></tbody>
            </table>
        `;

                                    loadWasteFG();
                                }

                                /* ================= WASTE BAHAN ================= */
                                if (type === "waste_bahan") {

                                    targetId = "produksi_waste_bahan";

                                    document.getElementById(targetId).innerHTML = `
            <h4>Waste Bahan Baku</h4>

            <table class="table table-dark table-striped">
                <thead>
                    <tr>
                        <th>Bahan</th>
                        <th>Qty Waste</th>
                        <th>Supplier</th>
                        <th>Keterangan</th>
                    </tr>
                </thead>
                <tbody id="wasteMaterialList"></tbody>
            </table>
        `;

                                    loadWasteMaterial();
                                }

                                document.getElementById(targetId).style.display = "block";
                                showPage("produksi");
                            }


                            /* ================= DROPDOWN PRODUK ================= */
                            async function loadProductionProducts() {
                                const q = query(collection(db, "products"), orderBy("code", "asc"));

                                initProductionFilter();

                                const snap = await getDocs(q);
                                const select = document.getElementById("prodProduct");
                                if (!select) return;
                                let html = `<option value="">Select Product</option>`;
                                snap.forEach(d => {
                                    const data = d.data();
                                    html += `<option value="${data.code}">${data.name}</option>`;
                                });
                                select.innerHTML = html;

                                await loadProductionListData();
                            }


                            /* ================= SAVE PRODUKSI ================= */
                            async function saveProduction() {
                                const productCode = document.getElementById("prodProduct").value;
                                const qty = Number(document.getElementById("prodQty").value);
                                const date = document.getElementById("prodDate").value;
                                if (!productCode || !qty || !date) {
                                    alert("Lengkapi data");
                                    return;
                                }

                                const snap = await getDocs(collection(db, "products"));
                                let productName = "";
                                snap.forEach(d => {
                                    if (d.data().code === productCode) {
                                        productName = d.data().name;
                                    }
                                });
                                const code = await generateCode("production_orders", "PRD");
                                await addDoc(collection(db, "production_orders"), {
                                    code,
                                    productCode,
                                    productName,
                                    qtyProduction: qty,
                                    date,
                                    createdAt: serverTimestamp()
                                });

                                alert("Produksi tersimpan");
                                await loadProductionListData();
                                document.getElementById("prodProduct").value = "";
                                document.getElementById("prodQty").value = "";
                            }


                            /* ================= LIST PRODUKSI ================= */
                            async function loadProductionListData() {
                                const selectedMonth = parseInt(document.getElementById("productionMonth").value);
                                const selectedYear = parseInt(document.getElementById("productionYear").value);
                                const snap = await getDocs(collection(db, "production_orders"));

                                let data = [];

                                snap.forEach(d => {
                                    data.push({ id: d.id, ...d.data() });
                                });

                                let html = "";

                                data.forEach(d => {

                                    const dateObj = new Date(d.date);
                                    const month = dateObj.getMonth() + 1;
                                    const year = dateObj.getFullYear();

                                    // 🔥 FILTER BULAN + TAHUN
                                    if (month !== selectedMonth || year !== selectedYear) {
                                        return;
                                    }

                                    html += `
        <tr>
            <td>${d.productCode}</td>
            <td>${d.productName}</td>
            <td>${d.qtyProduction}</td>
            <td>${d.date}</td>
            <td>
                <button class="btn btn-danger btn-sm"
                    onclick="deleteProduction('${d.id}')">
                    Delete
                </button>
                
                <button class="btn btn-info btn-sm"
                onclick="viewProductionDetail('${d.productCode}','${d.productName}',${d.qtyProduction})">
                    Detail
                </button>
            </td>
        </tr>
    `;
                                });
                                const el = document.getElementById("productionList");
                                if (el) el.innerHTML = html;
                            }

                            function initProductionFilter() {
                                const now = new Date();

                                const monthSelect = document.getElementById("productionMonth");
                                const yearSelect = document.getElementById("productionYear");

                                const months = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];

                                let mHtml = "";
                                months.forEach((m, i) => {
                                    mHtml += `<option value="${i + 1}">${m}</option>`;
                                });

                                monthSelect.innerHTML = mHtml;
                                monthSelect.value = now.getMonth() + 1;

                                let yHtml = "";

                                for (let y = 2025; y <= 2075; y++) {
                                    yHtml += `<option value="${y}">${y}</option>`;
                                }

                                yearSelect.innerHTML = yHtml;
                                yearSelect.value = new Date().getFullYear();
                            }

                            async function deleteProduction(id) {
                                if (!confirm("Yakin anda akan Hapus data produksi ini?")) return;
                                await deleteDoc(doc(db, "production_orders", id));
                                await loadProductionListData();
                            }

                            function clearProductionFilter() {
                                document.getElementById("productionDateFrom").value = "";
                                document.getElementById("productionDateTo").value = "";

                                loadProductionListData();
                            }

                            /* ================= HASIL PRODUKSI ================= */
                            async function loadProductionOrdersToResultSelect() {
                                const select = document.getElementById("resProduct");
                                if (!select) return;
                                const snap = await getDocs(
                                    query(collection(db, "production_orders"),
                                        orderBy("code", "asc"))
                                );
                                let html = `<option value="">Select Product</option>`;
                                const added = [];
                                snap.forEach(d => {
                                    const data = d.data();
                                    if (!added.includes(data.productCode)) {
                                        added.push(data.productCode);
                                        html += `
                <option value="${data.productCode}">
                    ${data.productCode} - ${data.productName}
                </option>
            `;
                                    }
                                });

                                select.innerHTML = html;
                            }

                            async function viewProductionDetail(code, name, qtyProd) {
                                forecastSource = "produksi";
                                showPage("productioncogs");
                                document.getElementById("productionCogsTitle").innerHTML =
                                    `COGS Produksi : ${name} | Qty : ${qtyProd}`;
                                const recipeSnap =
                                    await getDocs(collection(db, "product_recipes"));
                                const materialSnap = await getDocs(
                                    query(collection(db, "materials"), orderBy("code", "asc"))
                                );

                                let html = "";
                                let grandTotal = 0;

                                materialSnap.forEach(m => {
                                    const material = m.data();

                                    const recipe = recipeSnap.docs
                                        .map(r => r.data())
                                        .find(r =>
                                            r.productCode === code &&
                                            r.material === material.name
                                        );

                                    if (!recipe) return;

                                    const recipeQty = Number(recipe.qty);
                                    const materialPrice = Number(material.average);
                                    const totalMaterialQty = recipeQty * qtyProd;
                                    const totalCost = totalMaterialQty * materialPrice;

                                    grandTotal += totalCost;

                                    html += `
    <tr>
        <td>${material.code}</td>
        <td>${material.name}</td>
        <td>${material.unit || "-"}</td>
        <td>${recipeQty}</td>
        <td>Rp ${formatNumber(materialPrice)}</td>
        <td>${formatNumber(totalMaterialQty)}</td>
        <td>Rp ${formatNumber(totalCost)}</td>
    </tr>
    `;
                                });

                                // =====================
                                // HITUNG VARIABLE COST
                                // =====================
                                const variableCost = grandTotal * 0.01;
                                const grandTotalUsageValue = grandTotal + variableCost;

                                // =====================
                                // FOOTER TABEL
                                // =====================
                                html += `
<tr class="table-info fw-bold">
    <td colspan="6" class="text-end">
        VARIABLE COST (1%)
    </td>
    <td>
        Rp ${formatNumber(variableCost)}
    </td>
</tr>

<tr class="table-warning fw-bold">
    <td colspan="6" class="text-end">
        TOTAL USAGE VALUE
    </td>
    <td>
        Rp ${formatNumber(grandTotal)}
    </td>
</tr>

<tr class="table-success fw-bold">
    <td colspan="6" class="text-end">
        GRAND TOTAL USAGE VALUE
    </td>
    <td>
        Rp ${formatNumber(grandTotalUsageValue)}
    </td>
</tr>
`;

                                document.getElementById("productionCogsTable").innerHTML = html;

                            }

                            function backProduction() {
                                console.log("BACK clicked");
                                showPage('produksi_input');

                                console.log(document.getElementById('produksi'));
                            }

                            function deleteRecipeItem(index) {
                                recipeItems.splice(index, 1);
                                renderRecipeTable();
                            }

                            async function openProductionResult() {
                                showPage('produksi_hasil');

                                await loadProductionOrdersToResultSelect();
                                await loadProductionResult();
                            }
                            async function saveProductionResult() {
                                const productCode = document.getElementById("resProduct").value;
                                const fgPcs = document.getElementById("resFgPcs").value;
                                const fgBox = document.getElementById("resFgBox").value;
                                const date = document.getElementById("resDate").value;

                                if (!productCode || fgPcs === "" || fgBox === "" || !date) {
                                    alert("Lengkapi data");
                                    return;
                                }

                                let productName = "";
                                const prodSnap = await getDocs(collection(db, "products"));

                                prodSnap.forEach(d => {
                                    if (d.data().code === productCode) {
                                        productName = d.data().name;
                                    }
                                });

                                const code = await generateCode("production_results", "FG");

                                await addDoc(collection(db, "production_results"), {
                                    code,
                                    productCode,
                                    productName,
                                    fgPcs: Number(fgPcs),
                                    fgBox: Number(fgBox),
                                    date,
                                    createdAt: serverTimestamp()
                                });

                                alert("Hasil produksi berhasil disimpan");

                                document.getElementById("resFgPcs").value = "";
                                document.getElementById("resFgBox").value = "";

                                loadProductionResult();
                            }

                            async function loadProductionResult() {
                                const start = document.getElementById("prodStartDate").value;
                                const end = document.getElementById("prodEndDate").value;
                                const snap = await getDocs(
                                    query(collection(db, "production_results"))
                                );

                                let data = [];
                                snap.forEach(d => {
                                    data.push({ id: d.id, ...d.data() });
                                });

                                if (!start || !end) {
                                    alert("Pilih tanggal filter dulu");
                                    return;
                                }

                                let html = "";
                                data.forEach(d => {

                                    if (start && end) {
                                        const itemDate = new Date(d.date);
                                        const startDate = new Date(start);
                                        const endDate = new Date(end);

                                        if (itemDate < startDate || itemDate > endDate) return;
                                    }

                                    html += `
        <tr>
            <td>${d.productCode}</td>
            <td>${d.productName}</td>
            <td>${d.fgPcs}</td>
            <td>${d.fgBox}</td>
            <td>${d.date}</td>
            <td>
                <button class="btn btn-danger btn-sm"
                    onclick="deleteProductionResult('${d.id}')">
                    Delete
                </button>
            </td>
        </tr>
        `;
                                });

                                document.getElementById("productionResultList").innerHTML = html;
                            }


                            async function deleteProductionResult(id) {
                                if (!confirm("Hapus hasil produksi?")) return;
                                await deleteDoc(doc(db, "production_results", id));
                                loadProductionResult();
                            }

                            async function loadWasteFG() {
                                const start = document.getElementById("wasteFgStart").value;
                                const end = document.getElementById("wasteFgEnd").value;
                                const snap = await getDocs(collection(db, "waste_fg"));

                                let html = "";
                                snap.forEach(d => {
                                    const data = d.data();
                                    if (!data.date) return;

                                    if (start && end) {
                                        const itemDate = parseDate(data.date);
                                        const startDate = parseDate(start);
                                        const endDate = parseDate(end);

                                        if (!itemDate) return;
                                        if (itemDate < startDate || itemDate > endDate) return;
                                    }

                                    html += `
        <tr>
            <td>${data.productCode}</td>
            <td>${data.productName}</td>
            <td>${data.qty}</td>
            <td>${data.date}</td>
            <td>
                <button class="btn btn-danger btn-sm"
                    onclick="deleteWasteFG('${d.id}')">
                    Delete
                </button>
            </td>
        </tr>
        `;
                                });

                                document.getElementById("wasteFGList").innerHTML = html;
                            }
                            async function loadWasteMaterial() {
                                const start = document.getElementById("wasteMaterialStart").value;
                                const end = document.getElementById("wasteMaterialEnd").value;
                                const snap = await getDocs(collection(db, "waste_material"));
                                let html = "";
                                snap.forEach(d => {
                                    const data = d.data();

                                    if (!data.date) return;

                                    if (start && end) {
                                        const itemDate = parseDate(data.date);
                                        const startDate = parseDate(start);
                                        const endDate = parseDate(end);

                                        if (!itemDate) return;
                                        if (itemDate < startDate || itemDate > endDate) return;
                                    }

                                    html += `
        <tr>
            <td>${data.materialCode}</td>
            <td>${data.materialName}</td>
            <td>${data.qty}</td>
            <td>${data.unit}</td>
           <td>Rp ${formatNumber(data.price || 0)}</td>
            <td>${data.date}</td>
            <td>
                <button class="btn btn-danger btn-sm"
                    onclick="deleteWasteMaterial('${d.id}')">
                    Delete
                </button>
            </td>
        </tr>
        `;
                                });
                                document.getElementById("wasteMaterialList").innerHTML = html;
                            }

                            /* ================= FORECAST PRODUKSI ================= */
                            let forecastProductionData = [];
                            function parseDate(str) {
                                const [y, m, d] = str.split("-").map(Number);
                                return new Date(y, m - 1, d);
                            }

                            function formatBulan(start) {
                                const [y, m] = start.split("-");
                                const bulanNama = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];

                                return `${bulanNama[parseInt(m) - 1]} ${y}`;
                            }

                            async function viewForecastProduction() {
                                const start = document.getElementById("prodStartDate").value;
                                const end = document.getElementById("prodEndDate").value;

                                if (!start || !end) {
                                    alert("Pilih tanggal filter dulu");
                                    return;
                                }

                                showPage("forecast_production");

                                const recipeSnap = await getDocs(collection(db, "product_recipes"));
                                const materialSnap = await getDocs(collection(db, "materials"));
                                const priceFgSnap = await getDocs(collection(db, "price_fg"));
                                const q = query(
                                    collection(db, "production_results"),
                                    orderBy("date", "asc")
                                );

                                const prodSnap = await getDocs(q);
                                const materialMap = {};
                                let fgHtml = "";

                                const startDate = parseDate(start);
                                const endDate = parseDate(end);

                                prodSnap.forEach(prod => {
                                    const p = prod.data();
                                    const itemDate = parseDate(p.date);

                                    // Filter tanggal
                                    if (itemDate < startDate || itemDate > endDate) return;

                                    // ==========================
                                    // TABEL FINISHED GOODS
                                    // ==========================
                                    fgHtml += `
        <tr>
            <td>${p.productCode}</td>
            <td>${p.productName}</td>
            <td>${Number(p.fgPcs).toLocaleString()}</td>
            <td>${Number(p.fgBox).toLocaleString()}</td>
            <td>${new Date(p.date).toLocaleDateString("id-ID")}</td>
        </tr>
        `;

                                    // ==========================
                                    // HITUNG MATERIAL RECIPE
                                    // ==========================
                                    recipeSnap.forEach(recipe => {
                                        const r = recipe.data();
                                        if (r.productCode !== p.productCode) return;
                                        const material = materialSnap.docs
                                            .map(m => m.data())
                                            .find(m =>
                                                m.name.toLowerCase().trim() ===
                                                r.material.toLowerCase().trim()
                                            );

                                        if (!material) return;
                                        const key = material.code;
                                        const weight =
                                            Number(r.qty || 0) *
                                            Number(p.fgPcs || 0);

                                        const price =
                                            weight *
                                            Number(material.average || 0);

                                        if (!materialMap[key]) {
                                            materialMap[key] = {
                                                code: material.code,
                                                name: material.name,
                                                unit: material.unit,
                                                weight: 0,
                                                price: 0
                                            };
                                        }

                                        materialMap[key].weight += weight;
                                        materialMap[key].price += price;
                                    });

                                    // ==========================
                                    // HITUNG PEMAKAIAN BOX
                                    // ==========================
                                    const productCode = String(p.productCode || "").trim();
                                    const fgBox = Number(p.fgBox || 0);

                                    priceFgSnap.forEach(priceDoc => {
                                        const priceData = priceDoc.data();

                                        if (
                                            String(priceData.productCode || "").trim() !== productCode
                                        ) return;

                                        const boxName = String(priceData.materialName || "").trim();
                                        const boxMaterial = materialSnap.docs
                                            .map(m => m.data())
                                            .find(m =>
                                                String(m.name).trim().toLowerCase() ===
                                                boxName.toLowerCase()
                                            );

                                        if (!boxMaterial) return;
                                        const key = boxMaterial.code;
                                        const weight = fgBox;
                                        const price =
                                            weight *
                                            Number(boxMaterial.average || 0);

                                        if (!materialMap[key]) {
                                            materialMap[key] = {
                                                code: boxMaterial.code,
                                                name: boxMaterial.name,
                                                unit: boxMaterial.unit,
                                                weight: 0,
                                                price: 0
                                            };
                                        }

                                        materialMap[key].weight += weight;
                                        materialMap[key].price += price;
                                    });

                                });

                                // ==========================
                                // TAMPILKAN TABEL FG
                                // ==========================
                                document.getElementById("productionForecastTable").innerHTML = fgHtml;

                                // ==========================
                                // TABEL MATERIAL
                                // ==========================
                                forecastProductionData = Object.values(materialMap);
                                forecastProductionData.sort((a, b) =>
                                    a.code.localeCompare(b.code)
                                );

                                let html = "";
                                let totalUsageValue = 0;

                                forecastProductionData.forEach(item => {
                                    totalUsageValue += item.price;

                                    html += `
<tr>
    <td>${item.code}</td>
    <td>${item.name}</td>
    <td>${item.unit}</td>
    <td>${item.weight.toLocaleString()}</td>
    <td>Rp ${formatNumber(item.price)}</td>
</tr>
`;
                                });

                                // ===========================
                                // HITUNG VARIABLE COST
                                // ===========================
                                const variableCost = totalUsageValue * 0.01;
                                const grandTotalUsageValue = totalUsageValue + variableCost;

                                // ===========================
                                // TAMBAHKAN FOOTER TABEL
                                // ===========================
                                html += `
<tr class="table-info fw-bold">
    <td colspan="4" class="text-end">
        VARIABLE COST (1%)
    </td>
    <td>
       Rp ${formatNumber(variableCost)}
    </td>
</tr>

<tr class="table-warning fw-bold">
    <td colspan="4" class="text-end">
        TOTAL USAGE VALUE
    </td>
    <td>
        Rp ${formatNumber(totalUsageValue)}
    </td>
</tr>

<tr class="table-success fw-bold">
    <td colspan="4" class="text-end">
        GRAND TOTAL USAGE VALUE
    </td>
    <td>
       Rp ${formatNumber(grandTotalUsageValue)}
    </td>
</tr>
`;

                                document.getElementById("forecastProductionTitle").innerHTML =
                                    `Forecast Produksi Bulan ${formatBulan(start)}`;

                                document.getElementById("forecastProductionTable").innerHTML = html;
                            }

                            window.viewForecastProduction = viewForecastProduction;

                            /* ================= EXPORT PDF ================= */
                            async function exportForecastPDF() {
                                const { jsPDF } = window.jspdf;
                                const doc = new jsPDF("landscape", "pt", "a4");
                                const start = document.getElementById("prodStartDate").value;
                                const bulanNama = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];
                                const [y, m] = start.split("-");
                                const bulan = `${bulanNama[parseInt(m) - 1]} ${y}`;
                                doc.setFontSize(16);
                                doc.text(
                                    `Forecast Produksi Bulan ${bulan}`,
                                    40,
                                    40
                                );
                                // ==========================
                                // EXPORT TABEL FINISHED GOODS
                                // ==========================
                                doc.setFontSize(12);
                                doc.text(
                                    "Finished Goods Production",
                                    40,
                                    70
                                );
                                doc.autoTable({
                                    html: "#finishedGoodsForecastTable",
                                    startY: 85,
                                    theme: "grid",
                                    headStyles: {
                                        fillColor: [52, 58, 64]
                                    }
                                });
                                // ==========================
                                // EXPORT TABEL MATERIAL
                                // ==========================
                                let nextY = doc.lastAutoTable.finalY + 40;
                                doc.text(
                                    "Material Forecast",
                                    40,
                                    nextY
                                );
                                doc.autoTable({
                                    html: "#materialForecastTable",
                                    startY: nextY + 15,
                                    theme: "grid",
                                    headStyles: {
                                        fillColor: [52, 58, 64]
                                    }
                                });

                                // ==========================
                                // TOTAL
                                // ==========================
                                doc.save(
                                    `Forecast-Produksi-${bulan}.pdf`
                                );
                            }
                            window.exportForecastPDF = exportForecastPDF;

                            /* =========================================================
                            WASTE FG
                            ========================================================= */
                            async function openWasteFGPage() {
                                showPage("produksi_waste_fg");
                                const select = document.getElementById("wasteFgProduct");

                                if (!select) return;
                                const snap = await getDocs(
                                    query(
                                        collection(db, "products"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let html = `
                        <option value="">
                            Select Product
                        </option>
                        `;

                                snap.forEach(d => {
                                    const data = d.data();
                                    html += `
                        <option value="${data.code}">
                            ${data.code} - ${data.name}
                        </option>
                        `;
                                });

                                select.innerHTML = html;

                            }
                            async function saveWasteFG() {
                                const productCode = document.getElementById("wasteFgProduct")?.value;
                                const qty = document.getElementById("wasteFgQty")?.value;
                                const date = document.getElementById("wasteFgDate")?.value;

                                if (!productCode || !qty || !date) {
                                    alert("Lengkapi data");
                                    return;
                                }
                                let productName = "";
                                const snap = await getDocs(
                                    collection(db, "products")
                                );
                                snap.forEach(d => {

                                    if (d.data().code === productCode) {
                                        productName = d.data().name;
                                    }
                                });
                                await addDoc(
                                    collection(db, "waste_fg"),
                                    {
                                        productCode,
                                        productName,
                                        qty: Number(qty),
                                        date,
                                        createdAt: serverTimestamp()
                                    }
                                );

                                alert("Waste FG berhasil disimpan");
                                document.getElementById("wasteFgQty").value = "";
                                document.getElementById("wasteFgDate").value = "";
                                loadWasteFGTable();
                            }
                            async function loadWasteFGTable() {

                                const start = document.getElementById("wasteFgStart").value;
                                const end = document.getElementById("wasteFgEnd").value;
                                const tbody = document.getElementById("wasteFGList");

                                if (!start || !end) {
                                    tbody.innerHTML = "";
                                    document.getElementById("wasteFgTotal").innerHTML = "Total Waste FG : 0";
                                    return;
                                }

                                const snap = await getDocs(collection(db, "waste_fg"));

                                let data = [];
                                snap.forEach(d => {
                                    data.push({ id: d.id, ...d.data() });
                                });

                                let html = "";
                                let totalWaste = 0;

                                const startDate = new Date(start);
                                const endDate = new Date(end);
                                data.forEach(d => {

                                    const itemDate = new Date(d.date);

                                    if (itemDate < startDate || itemDate > endDate) return;
                                    totalWaste += Number(d.qty || 0);

                                    html += `
<tr>
    <td>${d.productCode}</td>
    <td>${d.productName}</td>
    <td>${d.qty}</td>
    <td>${d.date}</td>
    <td>
        <button class="btn btn-danger btn-sm"
            onclick="deleteWasteFG('${d.id}')">
            Delete
        </button>
    </td>
</tr>
`;
                                });

                                tbody.innerHTML = html;

                                document.getElementById("wasteFgTotal").innerHTML =
                                    `Total Waste FG : ${totalWaste}`;
                            }

                            async function deleteWasteFG(id) {
                                if (!confirm("Hapus waste FG ?")) return;
                                await deleteDoc(
                                    doc(db, "waste_fg", id)
                                );

                                loadWasteFGTable();

                            }

                            /* =========================================================
                            WASTE MATERIAL
                            ========================================================= */
                            async function openWasteMaterialPage() {
                                showPage("produksi_waste_bahan");
                                /* MATERIAL */
                                const materialSelect =
                                    document.getElementById("wasteMaterialName");
                                if (!materialSelect) return;
                                const materialSnap = await getDocs(
                                    query(
                                        collection(db, "materials"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let materialHtml = `
    <option value="">
        Select Material
    </option>
    `;

                                materialSnap.forEach(d => {
                                    const data = d.data();
                                    materialHtml += `
    <option value="${data.code}">
        ${data.code} - ${data.name}
    </option>
    `;
                                });
                                materialSelect.innerHTML = materialHtml;
                                /* UNIT */
                                const unitSnap = await getDocs(
                                    query(
                                        collection(db, "units"),
                                        orderBy("code", "asc")
                                    )
                                );

                                let unitHtml = "";
                                unitSnap.forEach(d => {
                                    unitHtml += `
    <option value="${d.data().name}">
        ${d.data().name}
    </option>
    `;
                                });

                                const unitEl =
                                    document.getElementById("wasteMaterialUnit");
                                if (unitEl) unitEl.innerHTML = unitHtml;
                                loadWasteMaterialTable();
                            }

                            async function calculateWasteMaterialPrice() {
                                const materialCode = document.getElementById("wasteMaterialName")?.value;
                                const qty = Number(document.getElementById("wasteMaterialQty")?.value);
                                if (!materialCode || !qty) {
                                    const priceEl = document.getElementById("wasteMaterialPrice");
                                    if (priceEl) priceEl.value = "";
                                    return;
                                }
                                const snap = await getDocs(
                                    collection(db, "materials")
                                );

                                let materialPrice = 0;
                                snap.forEach(d => {
                                    const data = d.data();
                                    if (data.code === materialCode) {
                                        materialPrice = Number(data.average);
                                    }
                                });
                                const total = qty * materialPrice;
                                const priceEl =
                                    document.getElementById("wasteMaterialPrice");
                                if (priceEl) {
                                    priceEl.value = total.toLocaleString();
                                }
                            }
                            async function saveWasteMaterial() {
                                const materialCode = document.getElementById("wasteMaterialName")?.value;
                                const qty = document.getElementById("wasteMaterialQty")?.value;
                                const unit = document.getElementById("wasteMaterialUnit")?.value;
                                const date = document.getElementById("wasteMaterialDate")?.value;

                                if (
                                    !materialCode || !qty || !unit || !date
                                ) {
                                    alert("Lengkapi data");
                                    return;
                                }

                                let materialName = "";
                                let materialPrice = 0;
                                const snap = await getDocs(
                                    collection(db, "materials")
                                );
                                snap.forEach(d => {
                                    const data = d.data();
                                    if (data.code === materialCode) {

                                        materialName = data.name;
                                        materialPrice = Number(data.average);
                                    }
                                });
                                const totalPrice =
                                    Number(qty) * materialPrice;
                                await addDoc(
                                    collection(db, "waste_material"),
                                    {
                                        materialCode,
                                        materialName,
                                        qty: Number(qty),
                                        unit,
                                        price: totalPrice,
                                        date,
                                        createdAt: serverTimestamp()
                                    }
                                );

                                alert("Waste bahan berhasil disimpan");
                                document.getElementById("wasteMaterialQty").value = "";
                                document.getElementById("wasteMaterialPrice").value = "";
                                document.getElementById("wasteMaterialDate").value = "";
                                loadWasteMaterialTable();
                            }
                            async function loadWasteMaterialTable() {
                                const start = document.getElementById("wasteMaterialStart")?.value;
                                const end = document.getElementById("wasteMaterialEnd")?.value;
                                const snap = await getDocs(
                                    query(
                                        collection(db, "waste_material"),
                                        orderBy("date", "desc")
                                    )
                                );

                                let html = "";

                                snap.forEach(d => {
                                    const data = d.data();

                                    if (start && end) {
                                        if (data.date < start || data.date > end) return;
                                    }

                                    html += `
        <tr>
            <td>${data.materialCode}</td>
            <td>${data.materialName}</td>
            <td>${data.qty}</td>
            <td>${data.unit}</td>
            <td>Rp ${Number(data.price).toLocaleString()}</td>
            <td>${data.date}</td>
            <td width="120">
                <button class="btn btn-danger btn-sm w-100"
                    onclick="deleteWasteMaterial('${d.id}')">
                    Delete
                </button>
            </td>
        </tr>
        `;
                                });

                                const el = document.getElementById("wasteMaterialList");
                                if (el) el.innerHTML = html;
                            }
                            async function deleteWasteMaterial(id) {
                                if (!confirm("Hapus waste bahan ?")) return;
                                await deleteDoc(
                                    doc(db, "waste_material", id)
                                );
                                loadWasteMaterialTable();
                            }

                            /* ================= MARKETING CODE ================= */
                            function toggleMarketing() {
                                const menu = document.getElementById("marketingSubMenu");
                                if (!menu) return;
                                menu.style.display = (menu.style.display === "block") ? "none" : "block";
                            }
                            /* ================= STORE CODE ================= */
                            async function generateStoreCode() {
                                const snap = await getDocs(
                                    query(collection(db, "stores"), orderBy("code", "desc"))
                                );
                                if (snap.empty) return "ST001";
                                const last = snap.docs[0].data().code;
                                const num = parseInt(last.replace("ST", "")) + 1;
                                return "ST" + String(num).padStart(3, "0");
                            }

                            /* SET STORE CODE INPUT */
                            async function setStoreCode() {
                                const el = document.getElementById("storeCode");
                                if (!el) return;

                                el.value = await generateStoreCode();
                            }

                            /* SAVE STORE */
                            async function saveStore() {
                                const code = document.getElementById("storeCode").value;
                                const name = document.getElementById("storeName").value;
                                const address = document.getElementById("storeAddress").value;
                                const phone = document.getElementById("storePhone").value;

                                if (!name || !address || !phone) {
                                    alert("Lengkapi data toko");
                                    return;
                                }

                                await addDoc(collection(db, "stores"), {
                                    code,
                                    name,
                                    address,
                                    phone,
                                    createdAt: serverTimestamp()
                                });

                                alert("Toko berhasil disimpan");

                                await loadStores();
                                await setStoreCode();
                                document.getElementById("storeName").value = "";
                                document.getElementById("storeAddress").value = "";
                                document.getElementById("storePhone").value = "";
                            }

                            /* LOAD STORES */
                            async function loadStores() {
                                const snap = await getDocs(collection(db, "stores"));
                                let data = [];
                                snap.forEach(d => {
                                    data.push({ id: d.id, ...d.data() });
                                });

                                data.sort((a, b) => {
                                    const numA = parseInt(a.code.replace("ST", ""));
                                    const numB = parseInt(b.code.replace("ST", ""));
                                    return numA - numB;
                                });

                                let html = "";

                                data.forEach(d => {
                                    html += `
<tr>
    <td>${d.code}</td>
    <td>${d.name}</td>
    <td>${d.address}</td>
    <td>${d.phone}</td>
    <td>
        <button class="btn btn-danger btn-sm w-100"
            onclick="deleteStore('${d.id}')">
            Delete
        </button>
    </td>
</tr>
`;
                                });

                                document.getElementById("storeList").innerHTML = html;
                                await setStoreCode();
                            }

                            /* DELETE STORE */
                            async function deleteStore(id) {
                                if (!confirm("Yakin anda akan Hapus data store ini?")) return;
                                await deleteDoc(doc(db, "stores", id));
                                await loadStores();
                                alert("Data Store berhasil dihapus");
                            }

                            /* =========================================================
                                    SALES FINISH GOOD
                            ========================================================= */
                            let salesFGRowIndex = 0;
                            /* OPEN PAGE */
                            async function openSalesFGPage() {
                                showPage("salesFinishGood");
                                document.getElementById("salesFGTable").innerHTML = "";

                                await addSalesFGRow();
                            }

                            /* LOAD STORE */
                            async function loadSalesFGStores() {
                                const q = query(collection(db, "stores"), orderBy("code", "asc"));
                                const snap = await getDocs(q);
                                let html = `<option value="">Select Store</option>`; snap.forEach(doc => {

                                    const d = doc.data();

                                    html += `
<option value="${d.code}">
    ${d.code} - ${d.name}
</option>
`;
                                });

                                document.getElementById(
                                    "salesFGStore"
                                ).innerHTML = html;
                            }

                            /* ADD ROW */
                            async function addSalesFGRow() {
                                salesFGRowIndex++;
                                const rowId = `salesfgrow${salesFGRowIndex}`;
                                const q = query(collection(db, "price_fg"), orderBy("productCode", "asc"));
                                const productSnap = await getDocs(q);

                                let productOptions = `<option value="">Select Product</option>`; productSnap.forEach(doc => {

                                    const d = doc.data();

                                    productOptions += `
<option value="${d.productCode}">
    ${d.productCode} - ${d.productName}
</option>
`;
                                });

                                const html = `
<tr id="${rowId}">
    <td>
        <select class="form-control salesfg-product"
            onchange="setSalesFGPrice(this)">
            ${productOptions}
        </select>
    </td>
    <td>
        <input type="number"
            class="form-control salesfg-box"
            value="0"
            oninput="calculateSalesFGTotal(this)">
    </td>
    <td>
        <input type="number"
            class="form-control salesfg-pcs auto-field"
            value="0"
            readonly>
    </td>
    <td>
        <input type="text"
            class="form-control salesfg-price auto-field"
            value="Rp. 0"
            readonly>
    </td>
    <td>
        <input type="text"
            class="form-control salesfg-total auto-field"
             value="Rp. 0"
            readonly>
    </td>
    <td>
        <button class="btn btn-danger btn-sm"
            onclick="removeSalesFGRow('${rowId}')">
            Delete
        </button>
    </td>
</tr>
`;

                                document.getElementById(
                                    "salesFGTable"
                                ).insertAdjacentHTML(
                                    "beforeend",
                                    html
                                );
                            }

                            /* REMOVE ROW */
                            function removeSalesFGRow(id) {
                                const el =
                                    document.getElementById(id);
                                if (el) el.remove();
                            }

                            /* SET PRICE */
                            async function setSalesFGPrice(selectEl) {
                                const row = selectEl.closest("tr");
                                const productCode = selectEl.value;
                                const priceInput = row.querySelector(".salesfg-price");
                                const snap = await getDocs(collection(db, "price_fg"));

                                let price = 0;
                                let qtyPerBox = 0;

                                snap.forEach(doc => {
                                    const data = doc.data();

                                    if (data.productCode === productCode) {
                                        price = Number(data.price || 0);
                                        qtyPerBox = Number(data.qtyPerBox || 0);
                                    }
                                });

                                // simpan qtyPerBox di row
                                row.dataset.qtyPerBox = qtyPerBox;
                                /* AUTO SET PRICE */
                                priceInput.value = price;
                                /* AUTO HITUNG TOTAL */
                                calculateSalesFGTotal(row.querySelector(".salesfg-box"));
                            }

                            /* CALCULATE TOTAL */
                            function calculateSalesFGTotal(inputEl) {

                                const row = inputEl.closest("tr");

                                const qtyBox = Number(row.querySelector(".salesfg-box").value || 0);
                                const price = Number(row.querySelector(".salesfg-price").value || 0);

                                // AMBIL qtyPerBox yang disimpan saat pilih produk
                                const qtyPerBox = Number(row.dataset.qtyPerBox || 0);

                                // Hitung Qty PCS otomatis
                                const qtyPcs = qtyBox * qtyPerBox;
                                row.querySelector(".salesfg-pcs").value = qtyPcs;

                                // Hitung Total Harga
                                const total = qtyBox * price;
                                row.querySelector(".salesfg-total").value =
                                    "Rp " + total.toLocaleString();
                            }

                            /* SAVE */
                            async function saveSalesFG() {
                                const store = document.getElementById("salesFGStore").value;
                                const date = document.getElementById("salesFGDate").value;
                                if (!store || !date) {
                                    alert("Lengkapi data");
                                    return;
                                }
                                const rows = document.querySelectorAll("#salesFGTable tr");
                                if (rows.length <= 0) {
                                    alert("Tambah produk");
                                    return;
                                }

                                for (const row of rows) {
                                    const productSelect = row.querySelector(".salesfg-product");
                                    const productCode = productSelect.value;
                                    const productName = productSelect.options[productSelect.selectedIndex].text;
                                    const qtyBox = Number(row.querySelector(".salesfg-box").value || 0);
                                    const qtyPcs = Number(row.querySelector(".salesfg-pcs").value || 0);
                                    const price = Number(row.querySelector(".salesfg-price").value || 0); const total = qtyBox * price;

                                    if (!productCode) continue;
                                    await addDoc(
                                        collection(db, "sales_fg"),
                                        {
                                            store,
                                            productCode,
                                            productName,
                                            qtyBox,
                                            qtyPcs,
                                            price,
                                            total,
                                            date,
                                            createdAt: serverTimestamp()
                                        }
                                    );
                                }

                                alert("Sales FG berhasil disimpan");
                                document.getElementById(
                                    "salesFGTable"
                                ).innerHTML = "";
                                addSalesFGRow();
                                loadSalesFGTable();
                            }

                            /* LOAD TABLE SALES FG */
                            async function loadSalesFGTable() {

                                const selectedMonth = parseInt(document.getElementById("salesFGMonth").value);
                                const selectedYear = parseInt(document.getElementById("salesFGYear").value);

                                // ===========================
                                // LOAD MASTER STORE
                                // ===========================
                                const storeSnap = await getDocs(collection(db, "stores"));

                                const storeMap = {};

                                storeSnap.forEach(doc => {
                                    const s = doc.data();

                                    storeMap[s.code] = s.name;
                                });

                                // ===========================
                                // LOAD SALES FG
                                // ===========================
                                const snap = await getDocs(collection(db, "sales_fg"));

                                let data = [];

                                snap.forEach(d => {
                                    data.push({
                                        id: d.id,
                                        ...d.data()
                                    });
                                });

                                // ===========================
                                // SORT BERDASARKAN KODE STORE
                                // ===========================
                                data.sort((a, b) => {

                                    const numA = parseInt((a.store || "").replace("ST", "")) || 0;
                                    const numB = parseInt((b.store || "").replace("ST", "")) || 0;

                                    return numA - numB;
                                });

                                let html = "";
                                let totalFG = 0;

                                data.forEach(d => {

                                    const dateObj = new Date(d.date);

                                    const month = dateObj.getMonth() + 1;
                                    const year = dateObj.getFullYear();

                                    if (month !== selectedMonth || year !== selectedYear) return;

                                    totalFG += Number(d.total || 0);

                                    html += `
<tr>
    <td>${d.store}</td>
    <td>${storeMap[d.store] || "-"}</td>
    <td>${d.productName}</td>
    <td>${d.qtyBox}</td>
    <td>${d.qtyPcs}</td>
    <td>Rp ${Number(d.price).toLocaleString()}</td>
    <td>Rp ${Number(d.total).toLocaleString()}</td>
    <td>${d.date}</td>
    <td>
        <button class="btn btn-danger btn-sm"
            onclick="deleteSalesFG('${d.id}')">
            Delete
        </button>
    </td>
</tr>
`;
                                });

                                document.getElementById("salesFGList").innerHTML = html;

                                document.getElementById("salesFGTotal").innerHTML =
                                    `Rp ${totalFG.toLocaleString()}`;
                            }

                            /* DELETE */
                            async function deleteSalesFG(id) {

                                if (!confirm("Yakin anda aka Hapus data Finihed Good ini ?")) return;

                                await deleteDoc(
                                    doc(db, "sales_fg", id)
                                );

                                loadSalesFGTable();
                            }
                            function initSalesFGFilter() {
                                const now = new Date();

                                const monthSelect = document.getElementById("salesFGMonth");
                                const yearSelect = document.getElementById("salesFGYear");

                                const months = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];

                                let mHtml = "";
                                months.forEach((m, i) => {
                                    mHtml += `<option value="${i + 1}">${m}</option>`;
                                });

                                monthSelect.innerHTML = mHtml;
                                monthSelect.value = now.getMonth() + 1;

                                let yHtml = "";
                                for (let y = 2025; y <= 2075; y++) {
                                    yHtml += `<option value="${y}">${y}</option>`;
                                }

                                yearSelect.innerHTML = yHtml;
                                yearSelect.value = now.getFullYear();
                            }

                            /* ================= SALES VALUE ================= */
                            async function openMarketingSales() {
                                showPage("marketing_sales");
                                initSalesFilter();
                                const q = query(collection(db, "stores"), orderBy("code", "asc"));
                                const snap = await getDocs(q);
                                let html = `<option value="">Select Store</option>`;
                                snap.forEach(d => {
                                    const data = d.data();
                                    html += `
<option value="${data.code}">
    ${data.code} - ${data.name}
</option>`;
                                });

                                const select = document.getElementById("salesStore");
                                if (select) select.innerHTML = html;
                                await loadSalesTable();
                            }

                            /* SAVE SALES */
                            async function saveSales() {
                                const storeCode = document.getElementById("salesStore").value;
                                const value = document.getElementById("salesValue").value;
                                const date = document.getElementById("salesDate").value;
                                if (!storeCode || !value || !date) {
                                    alert("Lengkapi data sales");
                                    return;
                                }

                                let storeName = "";
                                const snap = await getDocs(collection(db, "stores"));
                                snap.forEach(d => {
                                    if (d.data().code === storeCode) {
                                        storeName = d.data().name;
                                    }
                                });

                                await addDoc(collection(db, "sales"), {
                                    storeCode,
                                    storeName,
                                    value: Number(value),
                                    date,
                                    createdAt: serverTimestamp()
                                });

                                alert("Sales berhasil disimpan");

                                await loadSalesTable();

                                // Refresh cache + seluruh KPI/grafik dashboard setelah transaksi baru.
                                // loadSalesDashboard() tidak didefinisikan di aplikasi ini.
                                await refreshDashboard();

                                document.getElementById("salesValue").value = "";
                                document.getElementById("salesDate").value = "";
                            }

                            /* LOAD SALES TABLE (INPUT PAGE) */
                            async function loadSalesTable() {

                                const selectedMonth = parseInt(document.getElementById("salesMonth").value);
                                const selectedYear = parseInt(document.getElementById("salesYear").value);
                                const snap = await getDocs(collection(db, "sales"));

                                let data = [];
                                snap.forEach(d => {
                                    data.push({ id: d.id, ...d.data() });
                                });

                                data.sort((a, b) => {
                                    const numA = parseInt(a.storeCode.replace("ST", "")) || 0;
                                    const numB = parseInt(b.storeCode.replace("ST", "")) || 0;
                                    return numA - numB;
                                });

                                let html = "";
                                let totalSales = 0;
                                data.forEach(d => {

                                    const dateObj = new Date(d.date);
                                    const month = dateObj.getMonth() + 1;
                                    const year = dateObj.getFullYear();

                                    if (month !== selectedMonth || year !== selectedYear) {
                                        return;
                                    }

                                    totalSales += Number(d.value);

                                    html += `
<tr>
    <td>${d.storeCode}</td>
    <td>${d.storeName}</td>
    <td>Rp ${Number(d.value).toLocaleString()}</td>
    <td>${d.date}</td>
    <td>
        <button class="btn btn-danger btn-sm w-100"
            onclick="deleteSales('${d.id}')">
            Delete
        </button>
    </td>
</tr>`;
                                });

                                document.getElementById("salesList").innerHTML = html;

                                document.getElementById("salesTotal").innerHTML =
                                    `Rp ${totalSales.toLocaleString()}`;
                            }

                            function initSalesFilter() {
                                const now = new Date();

                                const monthSelect = document.getElementById("salesMonth");
                                const yearSelect = document.getElementById("salesYear");

                                const months = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];

                                let mHtml = "";
                                months.forEach((m, i) => {
                                    mHtml += `<option value="${i + 1}">${m}</option>`;
                                });

                                monthSelect.innerHTML = mHtml;
                                monthSelect.value = now.getMonth() + 1;

                                let yHtml = "";

                                for (let y = 2025; y <= 2075; y++) {
                                    yHtml += `<option value="${y}">${y}</option>`;
                                }

                                yearSelect.innerHTML = yHtml;
                                yearSelect.value = new Date().getFullYear();
                            }

                            /* DELETE SALES */
                            async function deleteSales(id) {
                                if (!confirm("Yakin anad akan Hapus Data Sales ini ?")) return;
                                await deleteDoc(doc(db, "sales", id));
                                await loadSalesTable();
                                await loadSalesReport();
                                alert("Sales berhasil dihapus");
                            }

                            /* =========================================================
                             TABEL DATA SUMMARY SALES REPORT
                            ========================================================= */
                            async function loadSalesReport() {
                                const start = document.getElementById("salesStartDate").value;
                                const end = document.getElementById("salesEndDate").value;

                                // BELUM PILIH TANGGAL
                                if (!start || !end) {
                                    document.getElementById("salesReportList").innerHTML = "";

                                    const totalEl = document.getElementById("salesReportTotal");
                                    if (totalEl) {
                                        totalEl.innerHTML = "Total Sales: Rp 0";
                                    }

                                    return;
                                }
                                const snap = await getDocs(collection(db, "sales"));
                                let data = [];
                                snap.forEach(d => {
                                    data.push({ id: d.id, ...d.data() });
                                });

                                data.sort((a, b) => {
                                    const numA = parseInt(a.storeCode.replace("ST", "")) || 0;
                                    const numB = parseInt(b.storeCode.replace("ST", "")) || 0;
                                    return numA - numB;
                                });

                                let html = "";
                                let total = 0;

                                data.forEach(d => {

                                    // filter tanggal (tetap kamu pakai)
                                    if (start && end) {
                                        const itemDate = new Date(d.date);
                                        const startDate = new Date(start);
                                        const endDate = new Date(end);

                                        if (itemDate < startDate || itemDate > endDate) return;
                                    }

                                    total += Number(d.value);

                                    html += `
<tr>
    <td>${d.storeCode}</td>
    <td>${d.storeName}</td>
    <td>Rp ${Number(d.value).toLocaleString()}</td>
    <td>${d.date}</td>
</tr>
`;
                                });

                                document.getElementById("salesReportList").innerHTML = html;
                                const totalEl = document.getElementById("salesReportTotal");
                                if (totalEl) {
                                    totalEl.innerHTML = `Total Sales: Rp ${total.toLocaleString()}`;
                                }
                            }

                            async function exportSalesPDF() {

                                const start = document.getElementById("salesStartDate").value;
                                const end = document.getElementById("salesEndDate").value;

                                if (!start || !end) {
                                    alert("Pilih Start Date dan End Date terlebih dahulu");
                                    return;
                                }

                                const { jsPDF } = window.jspdf;
                                const pdf = new jsPDF("p", "mm", "a4");

                                pdf.setFontSize(16);
                                pdf.text("Report Sales Pia Made Bali", 14, 15);

                                pdf.setFontSize(10);
                                pdf.text(`Periode : ${start} - ${end}`, 14, 22);

                                pdf.autoTable({
                                    html: "#salesReportExportTable",
                                    startY: 30,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 9
                                    },
                                    headStyles: {
                                        fillColor: [255, 193, 7],
                                        textColor: 0,
                                        fontStyle: "bold"
                                    }
                                });

                                const totalSales = document.getElementById("salesReportTotal").innerText;

                                pdf.setFontSize(11);
                                pdf.text(totalSales, 14, pdf.lastAutoTable.finalY + 10);

                                pdf.save(`Report_Sales_${start}_${end}.pdf`);
                            }

                            /* =========================================================
                            ACCOUNTING
                            ========================================================= */
                            function toggleAccounting() {

                                const menu = document.getElementById("accountingSubMenu");
                                if (!menu) {
                                    console.error("accountingSubMenu tidak ditemukan");
                                    return;
                                }

                                const isHidden = getComputedStyle(menu).display === "none";
                                menu.style.display = isHidden ? "block" : "none";
                            }

                            /* =========================================================
                            COST PRODUCTION
                            ========================================================= */
                            /* ================= OPEN PAGE ================= */
                            async function openProductionCost() {
                                showPage("productioncost");
                                await loadProductionCostReport();
                                calculateProductionCostTotal();
                            }

                            /* ================= AUTO TOTAL ================= */
                            function calculateProductionCostTotal() {
                                const salary = Number(document.getElementById("costSalary").value || 0);
                                const electric = Number(document.getElementById("costElectric").value || 0);
                                const gas = Number(document.getElementById("costGas").value || 0);
                                const internet = Number(document.getElementById("costInternet").value || 0);
                                const air = Number(document.getElementById("costAir").value || 0);
                                const bbm = Number(document.getElementById("costBahanBakar").value || 0);
                                const atk = Number(document.getElementById("costAlatTulis").value || 0);
                                const keamanan = Number(document.getElementById("costKeamanan").value || 0);
                                const sampah = Number(document.getElementById("costSampah").value || 0);
                                const overhead = Number(document.getElementById("costOverhead").value || 0);
                                const total = salary + electric + gas + internet + air + bbm + atk + keamanan + sampah + overhead;
                                document.getElementById("costTotal").innerHTML =
                                    `Rp ${formatNumber(total)}`;
                            }

                            /* ================= EVENT INPUT ================= */
                            document.addEventListener("input", function (e) {
                                if (
                                    e.target.classList.contains("cost-input")
                                ) {

                                    calculateProductionCostTotal();
                                }
                            });

                            /* ================= SAVE ================= */
                            async function saveProductionCost() {
                                const date =
                                    document.getElementById("costDate").value;
                                if (!date) {

                                    alert("Silahkan Select Posting Period Date dahulu...!!!");
                                    return;
                                }

                                const costData = [
                                    {
                                        code: "COST001", name: "Biaya Gaji Karyawan", value: Number(document.getElementById("costSalary").value || 0)
                                    },

                                    {
                                        code: "COST002", name: "Biaya Listrik PLN", value: Number(document.getElementById("costElectric").value || 0)
                                    },
                                    {
                                        code: "COST003", name: "Biaya Gas", value: Number(document.getElementById("costGas").value || 0)
                                    },
                                    {
                                        code: "COST004", name: "Biaya Telepon / Internet", value: Number(document.getElementById("costInternet").value || 0)
                                    },
                                    {
                                        code: "COST005", name: "Biaya Air Produksi", value: Number(document.getElementById("costAir").value || 0)
                                    },
                                    {
                                        code: "COST006", name: "Biaya Bahan Bakar Minyak / BBM", value: Number(document.getElementById("costBahanBakar").value || 0)
                                    },
                                    {
                                        code: "COST007", name: "Biaya Alat Tulis Kantor", value: Number(document.getElementById("costAlatTulis").value || 0)
                                    },
                                    {
                                        code: "COST008", name: "Biaya Kemanan", value: Number(document.getElementById("costKeamanan").value || 0)
                                    },
                                    {
                                        code: "COST009", name: "Biaya Kebersihan Sampah", value: Number(document.getElementById("costSampah").value || 0)
                                    },
                                    {
                                        code: "COST010", name: "Biaya Overhead Lainnya", value: Number(document.getElementById("costOverhead").value || 0)
                                    }
                                ];

                                let hasData = false;
                                for (const item of costData) {
                                    if (item.value <= 0) continue;
                                    hasData = true;
                                    await addDoc(
                                        collection(db, "production_cost"),
                                        {
                                            date,
                                            code: item.code,
                                            name: item.name,
                                            value: item.value,
                                            createdAt: serverTimestamp()
                                        }
                                    );
                                }

                                if (!hasData) {

                                    alert("Input cost terlebih dahulu");
                                    return;
                                }
                                alert("Cost Production berhasil disimpan");

                                /* RESET */

                                document.getElementById("costSalary").value = "";
                                document.getElementById("costElectric").value = "";
                                document.getElementById("costGas").value = "";
                                document.getElementById("costInternet").value = "";
                                document.getElementById("costAir").value = "";
                                document.getElementById("costBahanBakar").value = "";
                                document.getElementById("costAlatTulis").value = "";
                                document.getElementById("costKeamanan").value = "";
                                document.getElementById("costSampah").value = "";
                                document.getElementById("costOverhead").value = "";
                                document.getElementById("costTotal").innerHTML =
                                    "Rp 0";

                                await loadProductionCostReport();
                            }

                            /* ================= LOAD REPORT ================= */
                            async function loadProductionCostReport() {
                                const start = document.getElementById("costStartDate").value;
                                const end = document.getElementById("costEndDate").value;
                                const tbody = document.getElementById("productionCostList");
                                const grandTotalEl = document.getElementById("productionCostGrandTotal");

                                // RESET VIEW
                                tbody.innerHTML = `
        <tr>
            <td colspan="5" class="text-center text-muted">
                Silakan pilih tanggal untuk menampilkan data
            </td>
        </tr>
    `;

                                grandTotalEl.innerHTML = "Rp 0";
                                // kalau belum filter, STOP
                                if (!start || !end) return;
                                const snap = await getDocs(
                                    collection(db, "production_cost")
                                );

                                let html = "";
                                let grandTotal = 0;
                                snap.forEach(docSnap => {
                                    const data = docSnap.data();
                                    // FILTER RANGE
                                    if (data.date < start || data.date > end) return;
                                    grandTotal += Number(data.value || 0);

                                    html += `
            <tr>
                <td>${data.date}</td>
                <td>${data.code}</td>
                <td>${data.name}</td>
                <td>Rp ${formatNumber(data.value)}</td>
                <td class="text-center">
                    <button
                        class="btn btn-sm btn-danger"
                        onclick="deleteProductionCost('${docSnap.id}')">
                        Delete
                    </button>
                </td>
            </tr>
        `;
                                });

                                tbody.innerHTML =
                                    html ||
                                    `
        <tr>
            <td colspan="5" class="text-center">
                Tidak ada data pada periode ini
            </td>
        </tr>
        `;


                                grandTotalEl.innerHTML =
                                    `Rp ${formatNumber(grandTotal)}`;
                            }
                            /* ================= DELETE PRODUCTION COST ================= */
                            async function deleteProductionCost(id) {
                                const confirmDelete = confirm(
                                    "Apakah Anda yakin ingin menghapus data ini?"
                                );
                                if (!confirmDelete) return;
                                try {
                                    await deleteDoc(
                                        doc(db, "production_cost", id)
                                    );
                                    alert("Data berhasil dihapus");
                                    // refresh data setelah delete
                                    loadProductionCostReport();
                                } catch (error) {

                                    console.error(
                                        "Delete production cost error:",
                                        error
                                    );

                                    alert(
                                        "Gagal menghapus data"
                                    );
                                }
                            }

                            /* =========================================================
                                   OPEN PROFIT LOSS PAGE
                                ========================================================= */
                            function openProfitLoss() {
                                showPage("profitloss");
                            }

                            /* =========================================================
                               LOAD PROFIT LOSS
                            ========================================================= */
                            async function loadProfitLoss() {
                                const start =
                                    document.getElementById("plStartDate").value;
                                const end =
                                    document.getElementById("plEndDate").value;

                                if (!start || !end) {
                                    alert("Silahkan Lakukan select Start Date & End Date dahulu, kemudian click Load data...!!!");
                                    return;

                                }


                                /* ================= LOAD DATA ================= */
                                const salesSnap =
                                    await getDocs(collection(db, "sales"));
                                const prodSnap =
                                    await getDocs(collection(db, "production_results"));
                                const recipeSnap =
                                    await getDocs(collection(db, "product_recipes"));
                                const materialSnap =
                                    await getDocs(collection(db, "materials"));
                                const wasteMaterialSnap =
                                    await getDocs(collection(db, "waste_material"));
                                const wasteFGSnap =
                                    await getDocs(collection(db, "waste_fg"));

                                /* ================= SALES ================= */
                                let totalSales = 0;
                                salesSnap.forEach(docu => {
                                    const data = docu.data();
                                    if (data.date < start || data.date > end) return;
                                    totalSales += Number(data.value || 0);
                                });

                                /* ================= HPP ================= */
                                let totalCOGS = 0;
                                let fgMap = {};
                                prodSnap.forEach(prodDoc => {
                                    const prod = prodDoc.data();
                                    if (prod.date < start || prod.date > end) return;

                                    if (!fgMap[prod.productCode]) {

                                        fgMap[prod.productCode] = {
                                            qty: 0
                                        };
                                    }
                                    fgMap[prod.productCode].qty +=
                                        Number(prod.fgPcs || 0);
                                });

                                for (const productCode in fgMap) {
                                    const recipes = recipeSnap.docs
                                        .map(d => d.data())
                                        .filter(r =>
                                            r.productCode === productCode
                                        );

                                    for (const recipe of recipes) {
                                        const material = materialSnap.docs
                                            .map(d => d.data())
                                            .find(m =>
                                                m.name.toLowerCase().trim() ===
                                                recipe.material.toLowerCase().trim()
                                            );

                                        if (!material) continue;
                                        const usedQty =
                                            Number(recipe.qty || 0) *
                                            Number(fgMap[productCode].qty || 0);
                                        const totalValue =
                                            usedQty *
                                            Number(material.average || 0);

                                        totalCOGS += totalValue;
                                    }
                                }
                                totalCOGS *= 1.01;

                                /* ================= OVERHEAD COST ================= */
                                let totalOverhead = 0;
                                const costSnap =
                                    await getDocs(collection(db, "production_cost"));
                                costSnap.forEach(docu => {
                                    const data = docu.data();
                                    if (data.date < start || data.date > end) return;
                                    totalOverhead += Number(data.value || 0);
                                });


                                /* ================= WASTE MATERIAL ================= */
                                let totalWasteMaterial = 0;
                                wasteMaterialSnap.forEach(docu => {
                                    const data = docu.data();
                                    if (data.date < start || data.date > end) return;
                                    totalWasteMaterial +=
                                        Number(data.price || 0);
                                });

                                /* ================= WASTE FG ================= */
                                let totalWasteFG = 0;
                                wasteFGSnap.forEach(docu => {
                                    const waste = docu.data();
                                    if (waste.date < start || waste.date > end) return;
                                    const recipes = recipeSnap.docs
                                        .map(d => d.data())
                                        .filter(r =>
                                            r.productCode === waste.productCode
                                        );

                                    recipes.forEach(recipe => {

                                        const material = materialSnap.docs
                                            .map(d => d.data())
                                            .find(m =>
                                                m.name.toLowerCase().trim() ===
                                                recipe.material.toLowerCase().trim()
                                            );

                                        if (!material) return;

                                        const totalValue =
                                            Number(recipe.qty || 0) *
                                            Number(waste.qty || 0) *
                                            Number(material.average || 0);

                                        totalWasteFG += totalValue;
                                    });
                                });

                                /* ================= GROSS PROFIT ================= */
                                const grossProfit =
                                    totalSales -
                                    totalCOGS -
                                    totalOverhead -
                                    totalWasteMaterial -
                                    totalWasteFG;
                                /* ================= RENDER ================= */
                                document.getElementById("plSales").innerHTML =
                                    `Rp ${formatNumber(totalSales)}`;

                                document.getElementById("plCOGS").innerHTML =
                                    `Rp ${formatNumber(totalCOGS)}`;

                                document.getElementById("plOverhead").innerHTML =
                                    `Rp ${formatNumber(totalOverhead)}`;

                                document.getElementById("plWasteMaterial").innerHTML =
                                    `Rp ${formatNumber(totalWasteMaterial)}`;

                                document.getElementById("plWasteFG").innerHTML =
                                    `Rp ${formatNumber(totalWasteFG)}`;

                                document.getElementById("plGrossProfit").innerHTML =
                                    `Rp ${formatNumber(grossProfit)}`;
                            }

                            /* ================================================= */
                            /* ==========FUNCTION OPEN REPORT ACCOUNTING======= */
                            /* ================================================= */
                            let currentReport = "";

                            function openAccountingReport() {
                                showPage("accounting_report");
                            }
                            window.openAccountingReport = openAccountingReport;

                            function openReport(type) {
                                currentReport = type;

                                document.getElementById("productionReportArea").style.display =
                                    type === "production" ? "block" : "none";

                                document.getElementById("cogsReportArea").style.display =
                                    type === "cogs" ? "block" : "none";
                              
                                document.getElementById("profitLossReportArea").style.display =
                                    type === "profitlossreport" ? "block" : "none";

                                document.getElementById("generalReportArea").style.display =
                                (type === "production" ||
                                    type === "cogs" ||
                                    type === "profitlossreport")
                                    ? "none"
                                    : "block";

                                // set judul report
                                const title = document.getElementById("reportTitle");
                                if (type === "purchasing") {
                                    title.innerHTML = "Purchasing Report";
                                    document.getElementById("reportSubTitle").innerHTML =
                                        "Purchase Order Raw Material";
                                }

                                else if (type === "production") {
                                    title.innerHTML = "Production Report";
                                }

                                else if (type === "cogs") {
                                    title.innerHTML = "COGS Report";

                                }

                                else if (type === "profitlossreport") {
                                    title.innerHTML = "Profit & Loss Report";
                                }

                                // pindah halaman detail report
                                showPage("report_detail");
                            }

                            function backToReportMenu() {
                                showPage("accounting_report");
                                // reset table
                                document.getElementById("reportHead").innerHTML = "";
                                document.getElementById("reportBody").innerHTML = "";
                                document.getElementById("profitLossTableWrapper").style.display = "none";
                            }

                            function loadSelectedReport() {
                                if (currentReport === "purchasing") {
                                    loadPurchasingReport();
                                }
                                else if (currentReport === "production") {
                                    loadProductionReport();
                                }
                                else if (currentReport === "cogs") {
                                    loadCOGSReport();
                                }
                                else if (currentReport === "profitlossreport") {
                                    loadProfitLossReport();
                                }
                            }
                            async function exportReportPDF() {
                                if (currentReport === "purchasing") {
                                    return exportPurchasingPDF();
                                }
                                if (currentReport === "production") {
                                    return exportProductionPDF();
                                }
                                if (currentReport === "cogs") {
                                    return exportCOGSPDF();
                                }
                                if (currentReport === "profitlossreport") {
                                    return exportProfitLossPDF();
                                }
                            }

                            window.exportReportPDF = exportReportPDF;

                            /* ==========PURCHASE REPORT=========== */
                            async function loadPurchasingReport() {
                                let totalPurchasePrice = 0;
                              
                                const start = document.getElementById("reportStartDate").value;
                                const end = document.getElementById("reportEndDate").value;

                                if (!start || !end) {
                                    alert("Pilih Start Date dan End Date");
                                    return;
                                }

                                const snap = await getDocs(
                                    query(
                                        collection(db, "purchasing"),
                                        orderBy("date", "asc")
                                    )
                                );
                                let html = "";

                                document.getElementById("reportHead").innerHTML = `
        <tr>
            <th>Material Code</th>
            <th>Material Name</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Purchase Price</th>
            <th>Average</th>
            <th>Supplier</th>
            <th>Date</th>
        </tr>
    `;

                                snap.forEach(doc => {
                                    const d = doc.data();
                                    // filter date
                                    if (d.date < start || d.date > end) return;

                                    const qty = Number(d.qty || 0);
                                    const price = Number(d.price || 0);
                                    const avg = price / (qty || 1);
                                    totalPurchasePrice += price;

                                    html += `
            <tr>
                <td>${d.materialCode}</td>
                <td>${d.materialName}</td>
                <td>${qty}</td>
                <td>${d.unit}</td>
                <td>Rp ${formatNumber(price || 0)}</td>
                <td>Rp ${formatNumber(avg || 0)}</td>
                <td>${d.supplier}</td>
                <td>${d.date}</td>
            </tr>
        `;
                                });
                                html += `
            <tr class="table-warning text-dark fw-bold">
                <td colspan="4" class="text-end">
                    TOTAL PURCHASE PRICE
                </td>
                <td>
                    Rp ${formatNumber(totalPurchasePrice || 0)}
                </td>
                <td colspan="3"></td>
            </tr>
            `;

                                document.getElementById("reportBody").innerHTML = html;
                            }
                            /* ================= EXPORT PURCHASE PDF ================= */
                            async function exportPurchasingPDF() {
                                const purchaseTable =
                                    document.querySelectorAll(
                                        "#reportBody tr"
                                    );
                                if (purchaseTable.length === 0) {
                                    alert(
                                        "Data Purchasing belum di Load. Silakan Load Data terlebih dahulu sebelum Export PDF"
                                    );
                                    return;
                                }

                                const { jsPDF } = window.jspdf;
                                const doc = new jsPDF("landscape", "pt", "a4");

                                // ================= FILTER DATE =================
                                const startDate = document.getElementById("reportStartDate").value;
                                const endDate = document.getElementById("reportEndDate").value;

                                let q;

                                if (startDate && endDate) {

                                    q = query(
                                        collection(db, "purchasing"),
                                        where("date", ">=", startDate),
                                        where("date", "<=", endDate),
                                        orderBy("date", "asc")
                                    );

                                } else {

                                    q = query(
                                        collection(db, "purchasing"),
                                        orderBy("date", "asc")
                                    );
                                }

                                const snap = await getDocs(q);

                                if (snap.empty) {
                                    alert("Data kosong");
                                    return;
                                }

                                // ================= PRINT DATE =================
                                const today = new Date();
                                const printDate =
                                    today.getDate().toString().padStart(2, "0") + "/" +
                                    (today.getMonth() + 1).toString().padStart(2, "0") + "/" +
                                    today.getFullYear();

                                // ================= TOTAL =================
                                let totalPrice = 0;
                                const rows = [];
                                let no = 1;
                                snap.forEach(d => {
                                    const item = d.data();
                                    const qty = Number(item.qty || 0);
                                    const price = Number(item.price || 0);
                                    const avg = price / (qty || 1);

                                    totalPrice += price;

                                    rows.push([
                                        no++,
                                        item.materialCode,
                                        item.materialName,
                                        qty,
                                        item.unit,
                                        "Rp " + price.toLocaleString("id-ID"),
                                        "Rp " + avg.toLocaleString("id-ID"),
                                        item.supplier,
                                        item.date
                                    ]);
                                });

                                // ================= TITLE =================
                                doc.setFontSize(16);
                                doc.text("PURCHASE ORDER RAW MATERILAS REPORT", 40, 40);

                                doc.setFontSize(11);
                                doc.text(
                                    `PERIODE: ${startDate || "-"} s.d ${endDate || "-"}`,
                                    40,
                                    60
                                );

                                doc.text(`Print Date: ${printDate}`, 650, 60);

                                doc.setFontSize(12);
                                doc.text(
                                    `Total Purchase: Rp ${totalPrice.toLocaleString("id-ID")}`,
                                    40,
                                    80
                                );

                                // ================= TABLE =================
                                doc.autoTable({
                                    startY: 100,
                                    head: [[
                                        "No",
                                        "Kode",
                                        "Material Name",
                                        "Qty",
                                        "UOM",
                                        "Purchase Price",
                                        "Average",
                                        "Supplier",
                                        "Date"
                                    ]],
                                    body: rows,
                                    theme: "grid",
                                    styles: { fontSize: 9 },
                                    headStyles: { fillColor: [255, 193, 7] }
                                });

                                // ================= FILE NAME =================
                                let fileName = "Purchasing Report";

                                const bulan = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                                ];

                                if (startDate && endDate) {
                                    const [sy, sm] = startDate.split("-");
                                    const [ey, em] = endDate.split("-");
                                    if (sy === ey && sm === em) {
                                        fileName += ` ${bulan[parseInt(sm) - 1]} ${sy}`;
                                    } else if (sy === ey) {
                                        fileName += ` ${bulan[parseInt(sm) - 1]} - ${bulan[parseInt(em) - 1]} ${sy}`
                                    } else {
                                        fileName += ` ${startDate} s.d ${endDate}`;
                                    }
                                } else {
                                    fileName += ` ${bulan[today.getMonth()]} ${today.getFullYear()}`;
                                }

                                doc.save(`${fileName}.pdf`);
                            }
                            window.exportReportPDF = exportReportPDF;

                            // =======================================================
                            // ========== FUNCTION REPORT PRODUCTION DATA =============
                            // =======================================================
                            async function loadProductionReport() {

                                const start = document.getElementById("reportStartDate").value;
                                const end = document.getElementById("reportEndDate").value;

                                if (!start || !end) {
                                    alert("Pilih Start Date dan End Date");
                                    return;
                                }
                                const fgTable = document.getElementById("productionFGTable");
                                const materialTable = document.getElementById("productionMaterialTable");
                                fgTable.innerHTML = "";
                                materialTable.innerHTML = "";

                                try {

                                    // ================= LOAD DATA =================
                                    const prodSnap = await getDocs(collection(db, "production_results"));
                                    const recipeSnap = await getDocs(collection(db, "product_recipes"));
                                    const materialSnap = await getDocs(collection(db, "materials"));
                                    // ================= GROUP FG =================
                                    let fgMap = {};
                                    prodSnap.forEach(docu => {
                                        const prod = docu.data();
                                        // FILTER DATE
                                        if (prod.date < start || prod.date > end)
                                            return;

                                        const key = prod.productCode;
                                        if (!fgMap[key]) {

                                            fgMap[key] = {
                                                productCode: prod.productCode,
                                                productName: prod.productName,
                                                qty: 0,
                                                qtyPerBox: prod.fgBox,
                                                date: prod.date
                                            };
                                        }

                                        fgMap[key].qty += Number(
                                            prod.fgPcs || 0
                                        );
                                    });

                                    // ================= RENDER FG =================
                                    Object.values(fgMap)
                                        .sort((a, b) =>
                                            a.productCode.localeCompare(
                                                b.productCode
                                            )
                                        )
                                        .forEach(item => {

                                            fgTable.innerHTML += `
                <tr>
                    <td>${item.productCode}</td>
                    <td>${item.productName}</td>
                    <td>${item.qty}</td>
                    <td>${item.qtyPerBox}</td>
                    <td>${item.date}</td>
                </tr>
            `;
                                        });

                                    // ================= MATERIAL USAGE =================
                                    let materialUsage = {};
                                    let totalUsageValue = 0;

                                    // ================= LOAD PRICE FG UNTUK BOX =================
                                    const priceFgSnap = await getDocs(
                                        collection(db, "price_fg")
                                    );

                                    // ================= MATERIAL DARI RECIPE =================
                                    for (const fg of Object.values(fgMap)) {
                                        const recipes = recipeSnap.docs
                                            .map(d => d.data())
                                            .filter(r =>
                                                String(r.productCode).trim() ===
                                                String(fg.productCode).trim()
                                            );

                                        for (const recipe of recipes) {
                                            const material = materialSnap.docs
                                                .map(d => d.data())
                                                .find(m =>
                                                    String(m.name).trim().toLowerCase() ===
                                                    String(recipe.material).trim().toLowerCase()
                                                );

                                            if (!material) continue;

                                            const materialPrice = Number(material.average || 0);
                                            const usedQty = Number(recipe.qty || 0) * Number(fg.qty || 0);
                                            const usageValue = usedQty * materialPrice;

                                            totalUsageValue += usageValue;

                                            if (!materialUsage[material.code]) {
                                                materialUsage[material.code] = {
                                                    code: material.code,
                                                    name: material.name,
                                                    unit: material.unit,
                                                    qty: 0,
                                                    average: materialPrice,
                                                    value: 0
                                                };
                                            }

                                            materialUsage[material.code].qty += usedQty;
                                            materialUsage[material.code].value += usageValue;
                                        }
                                    }

                                    // ================= MATERIAL BOX DARI HASIL PRODUKSI =================
                                    prodSnap.forEach(prodDoc => {
                                        const prod = prodDoc.data();

                                        if (
                                            prod.date < start ||
                                            prod.date > end
                                        ) return;

                                        const productCode = String(prod.productCode || "").trim();
                                        const fgBox = Number(prod.fgBox || 0);

                                        priceFgSnap.forEach(priceDoc => {
                                            const price = priceDoc.data();

                                            if (
                                                String(price.productCode || "").trim() === productCode
                                            ) {

                                                const boxName = String(price.materialName || "").trim();

                                                const boxMaterial = materialSnap.docs
                                                    .map(d => d.data())
                                                    .find(m =>
                                                        String(m.name).trim().toLowerCase() ===
                                                        boxName.toLowerCase()
                                                    );

                                                if (!boxMaterial) return;

                                                const boxPrice = Number(boxMaterial.average || 0);
                                                const boxValue = fgBox * boxPrice;

                                                totalUsageValue += boxValue;

                                                if (!materialUsage[boxMaterial.code]) {
                                                    materialUsage[boxMaterial.code] = {
                                                        code: boxMaterial.code,
                                                        name: boxMaterial.name,
                                                        unit: boxMaterial.unit,
                                                        qty: 0,
                                                        average: boxPrice,
                                                        value: 0
                                                    };
                                                }

                                                materialUsage[boxMaterial.code].qty += fgBox;
                                                materialUsage[boxMaterial.code].value += boxValue;
                                            }
                                        });
                                    });

                                    // ================= HITUNG VARIABLE COST =================
                                    const variableCost = totalUsageValue * 0.01;
                                    const grandTotalUsageValue = totalUsageValue + variableCost;

                                    // ================= RENDER MATERIAL =================
                                    Object.values(materialUsage)
                                        .sort((a, b) =>
                                            a.code.localeCompare(
                                                b.code,
                                                undefined,
                                                {
                                                    numeric: true,
                                                    sensitivity: "base"
                                                }
                                            )
                                        )
                                        .forEach(mat => {

                                            materialTable.innerHTML += `
                                        <tr>
                                            <td>${mat.code}</td>
                                            <td>${mat.name}</td>
                                            <td>${mat.unit}</td>
                                            <td>${mat.qty.toFixed(2)}</td>
                                            <td>Rp ${mat.average.toLocaleString("id-ID")}</td>
                                            <td>Rp ${mat.value.toLocaleString("id-ID")}</td>
                                        </tr>
                                    `;
                                        });

                                    // ================= TOTAL ROW =================
                                    materialTable.innerHTML += `
                                <tr class="table-info text-dark fw-bold">
                                    <td colspan="5" class="text-end">
                                        VARIABLE COST (1%)
                                    </td>
                                    <td>
                                        Rp ${variableCost.toLocaleString("id-ID")}
                                    </td>
                                </tr>

                                <tr class="table-warning text-dark fw-bold">
                                    <td colspan="5" class="text-end">
                                        TOTAL USAGE VALUE
                                    </td>
                                    <td>
                                        Rp ${totalUsageValue.toLocaleString("id-ID")}
                                    </td>
                                </tr>

                                <tr class="table-success text-dark fw-bold">
                                    <td colspan="5" class="text-end">
                                        GRAND TOTAL USAGE VALUE
                                    </td>
                                    <td>
                                        Rp ${grandTotalUsageValue.toLocaleString("id-ID")}
                                    </td>
                                </tr>
                            `;
                                }
                                catch (error) {
                                    console.error(
                                        "Error load production report:",
                                        error
                                    );
                                    alert(
                                        "Gagal load Production Report"
                                    );
                                }
                            }

                            // ========= EXPORT PRODUCTION PDF ============
                            async function exportProductionPDF() {
                                const start =
                                    document.getElementById("reportStartDate").value;
                                const end =
                                    document.getElementById("reportEndDate").value;
                                // =========================
                                // VALIDASI DATE
                                // =========================
                                if (!start || !end) {
                                    alert(
                                        "Pilih Start Date dan End Date terlebih dahulu"
                                    );
                                    return;
                                }
                                const { jsPDF } = window.jspdf;
                                const pdf = new jsPDF(
                                    "l",
                                    "mm",
                                    "a4"
                                );
                                // =========================
                                // TITLE
                                // =========================
                                pdf.setFontSize(16);
                                pdf.text(
                                    "Production Report",
                                    14,
                                    15
                                );
                                pdf.setFontSize(10);
                                pdf.text(
                                    `Period : ${start} - ${end}`,
                                    14,
                                    22
                                );
                                // =========================
                                // FINISHED GOODS
                                // =========================
                                pdf.text(
                                    "Finished Goods Production",
                                    14,
                                    32
                                );
                                pdf.autoTable({
                                    html: "#productionFGExportTable",
                                    startY: 38,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 8
                                    },
                                    headStyles: {
                                        fillColor: [40, 167, 69],
                                        textColor: 255,
                                        fontStyle: "bold"
                                    }
                                });
                                // =========================
                                // MATERIAL USAGE
                                // =========================
                                let y =
                                    pdf.lastAutoTable.finalY + 15;
                                pdf.text(
                                    "Material Usage",
                                    14,
                                    y
                                );
                                pdf.autoTable({
                                    html: "#productionMaterialExportTable",
                                    startY: y + 5,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 8
                                    },
                                    headStyles: {
                                        fillColor: [255, 193, 7],
                                        textColor: 0,
                                        fontStyle: "bold"
                                    }
                                });
                                // =========================
                                // SAVE
                                // =========================
                                pdf.save(
                                    `Production_Report_${start}_${end}.pdf`
                                );

                            }
                            // =================================================
                            // ================= LOAD COGS REPORT ==============
                            // =================================================
                            async function loadCOGSReport() {
                                const start = document.getElementById("reportStartDate").value;
                                const end = document.getElementById("reportEndDate").value;
                                if (!start || !end) {
                                    alert("Pilih Start Date dan End Date");
                                    return;

                                }

                                // PERBAIKAN
                                const startDate = new Date(start);
                                const endDate = new Date(end);

                                const qtyTable = document.getElementById("cogsQtyTable");
                                const valueTable = document.getElementById("cogsValueTable");

                                qtyTable.innerHTML = "";
                                valueTable.innerHTML = "";

                                // =========================
                                // TOTAL VALUE
                                // =========================
                                let totalStockAwalValue = 0;
                                let totalPOValue = 0;
                                let totalWasteValue = 0;
                                let totalStockAkhirValue = 0;
                                let totalUsageProductionValue = 0;
                                let totalCogsValue = 0;
                                let totalDifferentValue = 0;
                                try {

                                    // =========================
                                    // MASTER MATERIAL
                                    // =========================
                                    const materialSnap =
                                        await getDocs(
                                            query(
                                                collection(db, "materials"),
                                                orderBy("code", "asc")
                                            )
                                        );

                                    // =========================
                                    // STOCK CARD
                                    // =========================
                                    const stockSnap =
                                        await getDocs(
                                            query(
                                                collection(db, "stock_opname"),
                                                orderBy("soDate", "asc")
                                            )
                                        );

                                    // =========================
                                    // STOCK AWAL
                                    // =========================
                                    let stockAwalMap = {};
                                    stockSnap.forEach(d => {
                                        const item = d.data();
                                        const code = String(item.code).trim();
                                        const date = new Date(item.soDate);

                                        if (date < startDate) {

                                            if (
                                                !stockAwalMap[code] ||
                                                date > stockAwalMap[code].date
                                            ) {

                                                stockAwalMap[code] = {
                                                    qty: Number(item.weight || 0),
                                                    date: date
                                                };

                                            }
                                        }

                                    });

                                    // =========================
                                    // PURCHASE ORDER
                                    // =========================
                                    const poSnap =
                                        await getDocs(
                                            query(
                                                collection(db, "purchasing"),
                                                where("date", ">=", start),
                                                where("date", "<=", end)
                                            )
                                        );

                                    let poMap = {};
                                    poSnap.forEach(d => {
                                        const item = d.data();
                                        const code =
                                            String(item.materialCode || "").trim();
                                        poMap[code] =
                                            (poMap[code] || 0) +
                                            Number(item.qty || 0);
                                    });

                                    // =========================
                                    // WASTE
                                    // =========================
                                    const wasteSnap =
                                        await getDocs(
                                            query(
                                                collection(db, "waste_material"),
                                                where("date", ">=", start),
                                                where("date", "<=", end)
                                            )
                                        );

                                    let wasteMap = {};
                                    wasteSnap.forEach(d => {
                                        const item = d.data();
                                        const name = String(item.materialName).trim();
                                        wasteMap[name] =
                                            (wasteMap[name] || 0) +
                                            Number(item.qty || 0);

                                    });

                                    // =========================
                                    // STOCK AKHIR
                                    // =========================
                                    let stockAkhirMap = {};
                                    stockSnap.forEach(d => {

                                        const item = d.data();
                                        const code = String(item.code).trim();
                                        const soDate = item.soDate;

                                        if (
                                            soDate >= start &&
                                            soDate <= end
                                        ) {

                                            if (
                                                !stockAkhirMap[code] ||
                                                soDate > stockAkhirMap[code].soDate
                                            ) {

                                                stockAkhirMap[code] = {
                                                    qty: Number(item.weight || 0),
                                                    soDate: soDate
                                                };
                                            }
                                        }

                                    });

                                    // =========================
                                    // PRODUKSI BERDASARKAN RECIPE
                                    // =========================
                                    const produksiSnap =
                                        await getDocs(
                                            query(
                                                collection(db, "production_orders"),
                                                where("date", ">=", start),
                                                where("date", "<=", end)
                                            )
                                        );
                                    const recipeSnap =
                                        await getDocs(collection(db, "product_recipes")
                                        );
                                    let produksiMap = {};
                                    // =========================
                                    // MATERIAL PRODUKSI
                                    // =========================
                                    produksiSnap.forEach(prodDoc => {
                                        const prod = prodDoc.data();
                                        const productCode = String(prod.productCode || "").trim();
                                        const qtyProduction = Number(prod.qtyProduction || 0);

                                        recipeSnap.forEach(recipeDoc => {
                                            const recipe = recipeDoc.data();

                                            if (
                                                String(recipe.productCode || "").trim()
                                                === productCode
                                            ) {
                                                const materialName =
                                                    String(recipe.material || "").trim();
                                                produksiMap[materialName] =
                                                    (produksiMap[materialName] || 0)
                                                    +
                                                    (
                                                        qtyProduction *
                                                        Number(recipe.qty || 0)
                                                    );
                                            }
                                        });
                                    });
                                    // =========================
                                    // BOX PRODUKSI
                                    // =========================
                                    const priceFgSnap =
                                        await getDocs(collection(db, "price_fg")
                                        );
                                    const productionResultSnap =
                                        await getDocs(
                                            query(
                                                collection(db, "production_results"),
                                                where("date", ">=", start),
                                                where("date", "<=", end)
                                            )
                                        );
                                    productionResultSnap.forEach(resultDoc => {
                                        const result = resultDoc.data();
                                        const productCode = String(result.productCode || "").trim();
                                        const fgBox = Number(result.fgBox || 0);

                                        priceFgSnap.forEach(priceDoc => {
                                            const price = priceDoc.data();

                                            if (
                                                String(price.productCode || "").trim()
                                                === productCode
                                            ) {
                                                const boxName =
                                                    String(price.materialName || "").trim();
                                                produksiMap[boxName] =
                                                    (produksiMap[boxName] || 0)
                                                    +
                                                    fgBox;
                                            }
                                        });
                                    });
                                    // =========================
                                    // GENERATE TABLE
                                    // =========================
                                    materialSnap.forEach(d => {
                                        const mat = d.data();
                                        const average = Number(mat.average || 0);
                                        const stockAwal = stockAwalMap[mat.code]?.qty || 0;
                                        const purchase = poMap[mat.code] || 0;
                                        const waste = wasteMap[mat.name] || 0;
                                        const stockAkhir = stockAkhirMap[mat.code]?.qty || 0;
                                        const cogs = produksiMap[mat.name] || 0;

                                        // =========================
                                        // PERHITUNGAN
                                        // =========================
                                        const usageProduction = stockAwal + purchase - waste - stockAkhir;
                                        const different = usageProduction - cogs;

                                        // =========================
                                        // TABLE QTY
                                        // =========================
                                        qtyTable.innerHTML += `
            <tr>
                <td>${mat.code}</td>
                <td>${mat.name}</td>
                <td>${mat.unit}</td>
                <td>Rp ${average.toLocaleString("id-ID")}</td>
                <td>${stockAwal.toLocaleString()}</td>
                <td>${purchase.toLocaleString()}</td>
                <td>${waste.toLocaleString()}</td>
                <td>${stockAkhir.toLocaleString()}</td>
                <td>${usageProduction.toLocaleString()}</td>
                <td>${cogs.toLocaleString()}</td>
                <td>${different.toLocaleString()}</td>
            </tr>
            `;

                                        // =========================
                                        // VALUE
                                        // =========================
                                        const valStockAwal = stockAwal * average;
                                        const valPurchase = purchase * average;
                                        const valWaste = waste * average;
                                        const valStockAkhir = stockAkhir * average;
                                        const valUsageProduction = usageProduction * average;
                                        const valCogs = cogs * average;
                                        const valDifferent = different * average;
                                        totalStockAwalValue += valStockAwal;
                                        totalPOValue += valPurchase;
                                        totalWasteValue += valWaste;
                                        totalStockAkhirValue += valStockAkhir;
                                        totalUsageProductionValue += valUsageProduction;
                                        totalCogsValue += valCogs;
                                        totalDifferentValue += valDifferent;

                                        // =========================
                                        // TABLE VALUE
                                        // =========================
                                        valueTable.innerHTML += `
            <tr>
                <td>${mat.code}</td>
                <td>${mat.name}</td>
                <td>${mat.unit}</td>
                <td>Rp ${average.toLocaleString("id-ID")}</td>
                <td>Rp ${valStockAwal.toLocaleString("id-ID")}</td>
                <td>Rp ${valPurchase.toLocaleString("id-ID")}</td>
                <td>Rp ${valWaste.toLocaleString("id-ID")}</td>
                <td>Rp ${valStockAkhir.toLocaleString("id-ID")}</td>
                <td>Rp ${valUsageProduction.toLocaleString("id-ID")}</td>
                <td>Rp ${valCogs.toLocaleString("id-ID")}</td>
                <td>Rp ${valDifferent.toLocaleString("id-ID")}</td>
            </tr>
            `;

                                    });
                                    // =========================
                                    // TOTAL
                                    // =========================
                                    valueTable.innerHTML += `
        <tr class="table-warning text-dark fw-bold">
            <td colspan="4">TOTAL</td>
            <td>Rp ${totalStockAwalValue.toLocaleString("id-ID")}</td>
            <td>Rp ${totalPOValue.toLocaleString("id-ID")}</td>
            <td>Rp ${totalWasteValue.toLocaleString("id-ID")}</td>
            <td>Rp ${totalStockAkhirValue.toLocaleString("id-ID")}</td>
            <td>Rp ${totalUsageProductionValue.toLocaleString("id-ID")}</td>
            <td>Rp ${totalCogsValue.toLocaleString("id-ID")}</td>
            <td>Rp ${totalDifferentValue.toLocaleString("id-ID")}</td>
        </tr>
        `;

                                }
                                catch (error) {
                                    console.error("COGS ERROR :", error);
                                    alert("Gagal Load COGS");
                                }
                            }
                            // ================= EXPORT COGS PDF ===============
                            async function exportCOGSPDF() {
                                const start = document.getElementById("reportStartDate").value;
                                const end = document.getElementById("reportEndDate").value;
                                // =========================
                                // VALIDASI DATE
                                // ========================
                                if (!start || !end) {
                                    alert(
                                        "Pilih Start Date dan End Date terlebih dahulu"
                                    );
                                    return;
                                }
                                const { jsPDF } = window.jspdf;
                                const pdf = new jsPDF(
                                    "l",
                                    "mm",
                                    "a4"
                                );
                                pdf.setFontSize(16);
                                pdf.text(
                                    "COGS Report",
                                    14,
                                    15
                                );
                                pdf.setFontSize(10);
                                pdf.text(
                                    `Period : ${start} - ${end}`,
                                    14,
                                    22
                                );
                                // =========================
                                // TABLE QTY
                                // =========================
                                pdf.text(
                                    "Material COGS Qty",
                                    14,
                                    32
                                );
                                pdf.autoTable({
                                    html: "#cogsQtyExportTable",
                                    startY: 38,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 8
                                    },
                                    headStyles: {
                                        fillColor: [40, 167, 69], // HIJAU
                                        textColor: 255,
                                        fontStyle: "bold"
                                    }
                                });
                                // =========================
                                // TABLE VALUE
                                // =========================
                                let y =

                                    pdf.lastAutoTable.finalY + 15;
                                pdf.text(
                                    "Material COGS Value",
                                    14,
                                    y
                                );
                                pdf.autoTable({
                                    html: "#cogsValueExportTable",
                                    startY: y + 5,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 8
                                    },
                                    headStyles: {
                                        fillColor: [255, 193, 7], // KUNING
                                        textColor: 0,
                                        fontStyle: "bold"
                                    }

                                });
                                pdf.save(

                                    `COGS_Report_${start}_${end}.pdf`
                                );
                            }

                      /* =======================================================
                        LOAD PROFIT LOSS REPORT DATA
                       ========================================================= */
                        function formatTanggalIndonesia(date) {
                            if (!date) return "";
                            const parts = date.split("-");
                            if (parts.length !== 3) return date;
                            return `${parts[2]}/${parts[1]}/${parts[0]}`;
                        }

                        async function loadProfitLossReport() {
                            const start = document.getElementById("reportStartDate").value;
                            const end = document.getElementById("reportEndDate").value;

                            if (!start || !end) {
                                alert("Silahkan Lakukan select Start Date & End Date dahulu, kemudian click Load data...!!!");
                                return;
                            }

                            /* ================= LOAD DATA ================= */
                            const salesSnap = await getDocs(collection(db, "sales"));
                            const prodSnap = await getDocs(collection(db, "production_results"));
                            const recipeSnap = await getDocs(collection(db, "product_recipes"));
                            const materialSnap = await getDocs(collection(db, "materials"));
                            const wasteMaterialSnap = await getDocs(collection(db, "waste_material"));
                            const wasteFGSnap = await getDocs(collection(db, "waste_fg"));

                            /* ================= SALES ================= */
                            let totalSales = 0;
                            salesSnap.forEach(docu => {
                                const data = docu.data();
                                if (data.date < start || data.date > end) return;
                                totalSales += Number(data.value || 0);

                            });

                            /* ================= HPP ================= */
                            let totalCOGS = 0;
                            let fgMap = {};

                            prodSnap.forEach(prodDoc => {
                                const prod = prodDoc.data();
                                if (prod.date < start || prod.date > end) return;

                                if (!fgMap[prod.productCode]) {

                                    fgMap[prod.productCode] = {
                                        qty: 0
                                    };
                                }
                                fgMap[prod.productCode].qty += Number(prod.fgPcs || 0);

                            });

                            for (const productCode in fgMap) {
                                const recipes = recipeSnap.docs
                                    .map(d => d.data())
                                    .filter(r => r.productCode === productCode);
                                for (const recipe of recipes) {
                                    const material = materialSnap.docs
                                        .map(d => d.data())
                                        .find(m =>
                                            m.name.toLowerCase().trim() ===
                                            recipe.material.toLowerCase().trim()
                                        );

                                    if (!material) continue;
                                    const usedQty =
                                        Number(recipe.qty || 0) *
                                        Number(fgMap[productCode].qty || 0);
                                    const totalValue =
                                        usedQty *
                                        Number(material.average || 0);
                                    totalCOGS += totalValue;
                                }
                            }
                            totalCOGS *= 1.01;

                            /* ================= PRODUCTION COST ================= */
                            let totalOverhead = 0;
                            const costSnap =
                                await getDocs(collection(db, "production_cost"));

                            costSnap.forEach(docu => {
                                const data = docu.data();
                                if (data.date < start || data.date > end) return;
                                totalOverhead += Number(data.value || 0);

                            });
                            /* ================= WASTE MATERIAL ================= */
                            let totalWasteMaterial = 0;
                            wasteMaterialSnap.forEach(docu => {
                                const data = docu.data();
                                if (data.date < start || data.date > end) return;
                                totalWasteMaterial += Number(data.price || 0);

                            });
                            /* ================= WASTE FG ================= */
                            let totalWasteFG = 0;
                            wasteFGSnap.forEach(docu => {
                                const waste = docu.data();
                                if (waste.date < start || waste.date > end) return;

                                const recipes = recipeSnap.docs
                                    .map(d => d.data())
                                    .filter(r => r.productCode === waste.productCode);

                                recipes.forEach(recipe => {
                                    const material = materialSnap.docs
                                        .map(d => d.data())
                                        .find(m =>
                                            m.name.toLowerCase().trim() ===
                                            recipe.material.toLowerCase().trim()
                                        );

                                    if (!material) return;
                                    const totalValue =
                                        Number(recipe.qty || 0) *
                                        Number(waste.qty || 0) *
                                        Number(material.average || 0);

                                    totalWasteFG += totalValue;
                                });
                            });

                            /* ================= PROFIT LOSS ================= */
                            const grossProfit =
                                totalSales - totalCOGS;

                            const totalExpense =
                                totalOverhead +
                                totalWasteMaterial +
                                totalWasteFG;

                            const netProfit =
                                grossProfit - totalExpense;
                            /* ================= UPDATE PROFIT LOSS TABLE ================= */
                             const rupiah = (value) =>
                                `Rp ${Number(value).toLocaleString("id-ID", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                })}`;

                            document.getElementById("profitLossResult").innerHTML = `
                            <div class="table-responsive">
                            <table class="table table-dark table-striped table-hover align-middle">
                            <tbody>
                            <tr>
                                <td width="65%">Periode</td>
                                <td class="text-end">
                                    ${formatTanggalIndonesia(start)} - ${formatTanggalIndonesia(end)}
                                </td>
                            </tr>
                            <tr class="table-warning">
                                <th colspan="2">Revenue</th>
                            </tr>
                            <tr>
                                <td>Sales Revenue</td>
                                <td class="text-end">${rupiah(totalSales)}</td>
                            </tr>
                            <tr>
                                <td><strong>Total Revenue</strong></td>
                                <td class="text-end">
                                    <strong>${rupiah(totalSales)}</strong>
                                </td>
                            </tr>
                            <tr class="table-warning">
                                <th colspan="2">Cost of Goods Sold</th>
                            </tr>
                            <tr>
                                <td>COGS</td>
                                <td class="text-end">${rupiah(totalCOGS)}</td>
                            </tr>
                            <tr>
                                <td><strong>Gross Profit</strong></td>
                                <td class="text-end">
                                    <strong>${rupiah(grossProfit)}</strong>
                                </td>
                            </tr>
                            <tr class="table-warning">
                                <th colspan="2">Operating Expense</th>
                            </tr>
                            <tr>
                                <td>Production Cost</td>
                                <td class="text-end">${rupiah(totalOverhead)}</td>
                            </tr>
                            <tr>
                                <td>Waste Material</td>
                                <td class="text-end">${rupiah(totalWasteMaterial)}</td>
                            </tr>
                            <tr>
                                <td>Waste FG</td>
                                <td class="text-end">${rupiah(totalWasteFG)}</td>
                            </tr>
                            <tr>
                                <td><strong>Total Expense</strong></td>
                                <td class="text-end">
                                    <strong>${rupiah(totalExpense)}</strong>
                                </td>
                            </tr>
                            <tr class="${netProfit >= 0 ? "table-success" : "table-danger"}">
                                <th style="font-size:18px;">NET PROFIT</th>
                                <th class="text-end" style="font-size:18px;">
                                    ${rupiah(netProfit)}
                                </th>
                            </tr>
                            </tbody>
                            </table>
                            </div>
                            `;
                        }

                       /* =========================================================
                        EXPORT PROFIT LOSS PDF
                        ========================================================= */
                        async function exportProfitLossPDF() {
                            const table = document.querySelector("#profitLossResult table");
                            if (!table) {
                                alert("Silahkan Load Data Profit & Loss terlebih dahulu");
                                return;
                            }
                            const start =
                                document.getElementById("reportStartDate").value;
                            const end =
                                document.getElementById("reportEndDate").value;
                            const {jsPDF} = window.jspdf;
                            const pdf =
                                new jsPDF(
                                    "p",
                                    "mm",
                                    "a4"
                                );

                            pdf.setFontSize(16);
                            pdf.text(
                                "PROFIT & LOSS REPORT",
                                105,
                                15,
                                {
                                    align: "center"
                                }
                            );
                            pdf.setFontSize(14);
                            pdf.text(
                                "PIA MADE BALI",
                                105,
                                23,
                                {
                                    align: "center"
                                }
                            );
                            pdf.setFontSize(10);
                            pdf.text(
                                `Periode : ${formatTanggalIndonesia(start)} - ${formatTanggalIndonesia(end)}`,
                                105,
                                30,
                                {
                                    align: "center"
                                }
                            );
                            pdf.autoTable({
                                html: "#profitLossResult table",
                                startY: 38,
                                theme: "grid",
                                styles: {
                                    fontSize: 10,
                                    cellPadding: 3
                                },
                                headStyles: {
                                    fillColor: [
                                        33,
                                        37,
                                        41
                                    ],

                                    textColor: 255

                                },
                                columnStyles: {
                                    0: {
                                        halign: "left"
                                    },

                                    1: {
                                        halign: "right"
                                    }
                                }
                            });
                            pdf.save(
                                `Profit_Loss_Report_${start}_${end}.pdf`
                            );
                        }

                            /* =================================================== */
                            /* ============= STOCK CARD WAREHOUSE =============== */
                            /* =================================================== */
                            function toggleGudang() {
                                const menu = document.getElementById("gudangSubMenu");
                                menu.style.display =
                                    menu.style.display === "block"
                                        ? "none"
                                        : "block";
                            }
                            /* ================= GLOBAL STOCK AWAL ================= */
                            /* ================= READ STOCK AWAL EXCEL ============= */
                            let stockAwalExcelData = [];

                            async function readStockAwalExcel() {
                                const file = document.getElementById("stockAwalFile").files[0];
                                if (!file) {
                                    alert("Pilih file excel");
                                    return;
                                }

                                const stockDate = document.getElementById("stockAwalDate").value;
                                if (!stockDate) {
                                    alert("Pilih tanggal stock awal");
                                    return;
                                }
                                const reader = new FileReader();
                                reader.onload = async function (e) {
                                    try {
                                        const data = new Uint8Array(e.target.result);
                                        const workbook = XLSX.read(data, { type: "array" });
                                        const sheet = workbook.Sheets[workbook.SheetNames[0]];
                                        const json = XLSX.utils.sheet_to_json(sheet);
                                        const materialSnap =
                                            await getDocs(
                                                collection(db, "materials")
                                            );

                                        let materialMap = {};
                                        materialSnap.forEach(d => {
                                            const m = d.data();
                                            materialMap[
                                                String(m.code).trim()
                                            ] = m;
                                        });
                                        stockAwalExcelData = [];
                                        let html = "";
                                        let grandTotal = 0;
                                        let totalData = 0;
                                        json.forEach(item => {
                                            const code =
                                                item["Kode"] ||
                                                item["kode"];
                                            const weight =
                                                Number(item["Weight"] || 0);
                                            if (!code) return;
                                            const material =
                                                materialMap[
                                                String(code).trim()
                                                ];

                                            if (!material) return;
                                            const average =
                                                Number(material.average || 0);
                                            const value =
                                                average * weight;
                                            grandTotal += value;
                                            totalData++;
                                            const row = {
                                                code: material.code,
                                                name: material.name,
                                                unit: material.unit,
                                                weight,
                                                average,
                                                value,
                                                stockDate
                                            };

                                            stockAwalExcelData.push(row);
                                            html += `
                    <tr>
                        <td>${row.code}</td>
                        <td>${row.name}</td>
                        <td>${row.unit}</td>
                        <td>${Number(row.weight).toLocaleString()} </td>        
                        <td>Rp ${Number(row.average).toLocaleString()}</td>
                        <td>Rp ${Number(row.value).toLocaleString()} </td> 
                        <td>${row.stockDate}</td>

                    </tr>
                `;
                                        });
                                        document.getElementById("stockAwalTable")
                                            .innerHTML = html;
                                        document.getElementById("stockAwalTotalValue")
                                            .innerHTML =
                                            "Rp " + grandTotal.toLocaleString();
                                        document.getElementById("stockAwalTotalData")
                                            .innerHTML =
                                            totalData.toLocaleString();
                                        alert("Excel berhasil dibaca");
                                    } catch (err) {
                                        console.error(err);
                                        alert("Gagal membaca excel");
                                    }
                                };
                                reader.readAsArrayBuffer(file);
                            }
                            window.readStockAwalExcel = readStockAwalExcel;

                            /* ================= SAVE STOCK AWAL ================= */
                            async function saveStockAwalData() {
                                if (stockAwalExcelData.length === 0) {
                                    alert("Data kosong");
                                    return;
                                }
                                try {
                                    const oldSnap = await getDocs(collection(db, "stock_card"));
                                    for (const docItem of oldSnap.docs) {
                                        await deleteDoc(
                                            doc(db, "stock_card", docItem.id)
                                        );
                                    }

                                    // ===============================
                                    // INSERT DATA BARU
                                    // ===============================
                                    for (const item of stockAwalExcelData) {
                                        await addDoc(
                                            collection(db, "stock_card"),
                                            {
                                                ...item,
                                                type: "OPENING",
                                                createdAt: serverTimestamp()
                                            }
                                        );
                                    }

                                    alert(
                                        "Stock awal berhasil refresh stock card"
                                    );
                                } catch (err) {
                                    console.error(err);
                                    alert("Gagal save stock awal");
                                }
                            }
                            window.saveStockAwalData = saveStockAwalData;
                            /* ================= LOAD STOCK AWAL TABLE ================= */
                            async function loadStockAwalTable() {
                                try {
                                    const snap = await getDocs(
                                        query(
                                            collection(db, "stock_card"),
                                            orderBy("code", "asc")
                                        )
                                    );

                                    let html = "";
                                    let grandTotal = 0;
                                    let totalData = 0;

                                    snap.forEach(doc => {
                                        const item = doc.data();

                                        if (item.type !== "OPENING") return;
                                        grandTotal += Number(item.value || 0);
                                        totalData++;

                                        html += `
                <tr>
                    <td>${item.code}</td>
                    <td>${item.name}</td>
                    <td>${item.unit}</td>
                    <td class="text-end"> ${Number(item.weight).toLocaleString()}  </td>
                    <td class="text-end">Rp ${Number(item.average).toLocaleString()} </td>                
                    <td class="text-end"> Rp ${Number(item.value).toLocaleString()}</td>
                    <td>${item.stockDate}</td>
                </tr>
            `;

                                    });
                                    document.getElementById("stockAwalSavedTable").innerHTML = html;
                                    console.log(
                                        "Opening Stock Loaded :",
                                        totalData,
                                        "Rows"
                                    );


                                } catch (err) {
                                    console.error("Load Stock Awal Error :", err);
                                }
                            }
                            window.loadStockAwalTable = loadStockAwalTable;

                            /* ================= UPLOAD NEW SO MATERIALS ================= */
                            /* ================= READ EXCEL ================= */
                            let soExcelData = [];
                            let soDataLoaded = false;

                            async function readSOExcel() {
                                const file = document.getElementById("soFile").files[0];
                                if (!file) {
                                    alert("Pilih file excel");
                                    return;
                                }
                                const soDate = document.getElementById("soDate").value;
                                if (!soDate) {
                                    alert("Pilih tanggal SO");
                                    return;
                                }
                                const reader = new FileReader();
                                reader.onload = async function (e) {

                                    try {
                                        const data = new Uint8Array(e.target.result);
                                        const workbook = XLSX.read(data, { type: "array" });
                                        const sheet = workbook.Sheets[workbook.SheetNames[0]];
                                        const json =
                                            XLSX.utils.sheet_to_json(sheet);
                                        if (json.length === 0) {
                                            alert("Excel kosong");
                                            return;
                                        }
                                        // LOAD MASTER MATERIAL
                                        const materialSnap =
                                            await getDocs(
                                                query(
                                                    collection(db, "materials"),
                                                    orderBy("code", "asc")
                                                )
                                            );

                                        let materialMap = {};
                                        materialSnap.forEach(d => {
                                            const m = d.data();
                                            materialMap[
                                                String(m.code).trim()
                                            ] = m;
                                        });

                                        soExcelData = [];
                                        let html = "";
                                        let grandTotal = 0;
                                        let totalData = 0;
                                        json.forEach(item => {
                                            // HEADER EXCEL
                                            const code =
                                                item["Kode"] ||
                                                item["kode"] ||
                                                item["KODE"];
                                            const weight =
                                                Number(
                                                    item["Weight"] ||
                                                    item["weight"] ||
                                                    item["WEIGHT"] ||
                                                    0
                                                );

                                            if (!code) return;
                                            const material =
                                                materialMap[
                                                String(code).trim()
                                                ];
                                            if (!material) {
                                                console.warn(
                                                    "Material tidak ditemukan:",
                                                    code
                                                );
                                                return;
                                            }
                                            const average = Number(material.average || 0);
                                            const value = average * weight;
                                            grandTotal += value; totalData++;
                                            const row = {
                                                code: material.code,
                                                name: material.name,
                                                unit: material.unit,
                                                weight,
                                                average,
                                                value,
                                                soDate
                                            };
                                            soExcelData.push(row);
                                            html += `
                <tr>
                    <td>${row.code}</td>
                    <td>${row.name}</td>
                    <td>${row.unit}</td>
                    <td>${Number(row.weight).toLocaleString()} </td>
                    <td>Rp ${Number(row.average).toLocaleString()}</td>   
                    <td>Rp ${Number(row.value).toLocaleString()}</td>
                    <td>${row.soDate}</td>
                </tr>
            `;
                                        });
                                        document.getElementById("soTable").innerHTML = html;
                                        document.getElementById("soTotalValue").innerHTML = "Rp " + grandTotal.toLocaleString();
                                        document.getElementById("soTotalData").innerHTML = totalData.toLocaleString();
                                        alert(
                                            "Excel berhasil dibaca : " + totalData + " data"
                                        );
                                    } catch (err) {
                                        console.error(err); alert("Gagal membaca excel");
                                    }
                                };
                                reader.readAsArrayBuffer(file);
                            }
                            window.readSOExcel = readSOExcel;

                            /* ================= SAVE SO DATA ================= */
                            async function saveSOData() {
                                const soDate = document.getElementById("soDate").value;
                
                                if (!soDate) {
                                    alert("Pilih tanggal SO");
                                    return;
                                }
                
                                if (soExcelData.length === 0) {
                                    alert("Data SO kosong");
                                    return;
                                }
                
                                try {
                
                                    // CEK DATA LAMA
                                    const q = query(
                                        collection(db, "stock_opname"),
                                        where("soDate", "==", soDate)
                                    );
                
                                    const oldSnap = await getDocs(q);
                                    // JIKA ADA DATA LAMA
                                    if (!oldSnap.empty) {
                
                                        const ok = confirm(
                                            `Data tanggal ${soDate} sudah ada (${oldSnap.size} data).

` +
                                            `Klik OK untuk mengganti data lama.`
                                        );
                
                                        if (!ok) return;
                
                                        // HAPUS SATU PERSATU
                                        for (const d of oldSnap.docs) {
                                            await deleteDoc(d.ref);
                                        }
                                    }
                
                                    // SIMPAN DATA BARU SATU PERSATU
                                    for (const item of soExcelData) {
                                        await addDoc(collection(db, "stock_opname"), {
                                            code: item.code,
                                            name: item.name,
                                            unit: item.unit,
                                            weight: Number(item.weight),
                                            average: Number(item.average),
                                            value: Number(item.value),
                                            soDate: soDate,
                                            createdAt: serverTimestamp()
                                        });
                
                                    }
                
                                    alert(`Berhasil simpan ${soExcelData.length} data SO`);
                                    await loadSOData();
                                } catch (err) {
                
                                    console.error(err);
                
                                    alert("Gagal simpan data: " + err.message);
                                }
                            }
                
                            window.saveSOData = saveSOData;
                
                            /* ================= DELETE CURRENT BATCH ================= */
                            async function deleteCurrentSOBatch() {
                                const soDate = document.getElementById("soDate").value;
                
                                if (!soDate) {
                                    alert("Pilih tanggal SO terlebih dahulu");
                                    return;
                                }
              
                                const ok = confirm(`Hapus semua data tanggal ${soDate}?`);
                                if (!ok) return;
                              
                                try {
                                    const q = query(
                                        collection(db, "stock_opname"),
                                        where("soDate", "==", soDate)
                                    );
                
                                    const snap = await getDocs(q);
                                    if (snap.empty) {
                                        alert("Data tidak ditemukan");
                                        return;
                                    }
                
                                    let total = 0;
                                    for (const d of snap.docs) {
                                        await deleteDoc(d.ref);
                                        total++;
                                    }
                
                                    alert(`Berhasil menghapus ${total} data`);
                                    await loadSOData();
                
                                } catch (err) {
                                    console.error(err);
                                    alert("Gagal hapus data: " + err.message);
                                }
                            }
                
                            window.deleteCurrentSOBatch = deleteCurrentSOBatch;

                            /* ================= LOAD YEAR ================= */
                            function loadSOYears() {
                                const select = document.getElementById("filterSOYear");
                                const currentYear = new Date().getFullYear();

                                let html = '<option value="">All Year</option>';
                                for (let y = 2025; y <= 2075; y++) {
                                    html += `<option value="${y}">${y}</option>`;
                                }
                                select.innerHTML = html;

                            }

                            loadSOYears();
                            document.getElementById("filterSOMonth").addEventListener("change", () => {
                                soDataLoaded = false;
                            });

                            document.getElementById("filterSOYear").addEventListener("change", () => {
                                soDataLoaded = false;
                            });

                            /* ================= LOAD SO DATA ================= */
                            async function loadSOData() {

                                const month = document.getElementById("filterSOMonth").value;
                                const year = document.getElementById("filterSOYear").value;
                                const q = query(
                                    collection(db, "stock_opname")
                                );

                                const snap = await getDocs(q);
                                let data = [];
                                snap.forEach(d => {

                                    const item = d.data();
                                    // soDate format : YYYY-MM-DD
                                    const parts = item.soDate.split("-");
                                    const itemYear = parts[0];
                                    const itemMonth = parts[1];

                                    if (year && itemYear !== year) return;
                                    if (month && itemMonth !== month) return;
                                    data.push(item);

                                });
                                data.sort((a, b) =>
                                    a.code.localeCompare(b.code, undefined, {
                                        numeric: true,
                                        sensitivity: "base"
                                    })
                                );

                                let html = "";
                                let grandTotal = 0;
                                let totalData = 0;
                                data.forEach(item => {

                                    grandTotal += Number(item.value || 0);
                                    totalData++;

                                    html += `
        <tr>
            <td>${item.code}</td>
            <td>${item.name}</td>
            <td>${item.unit}</td>
            <td>${Number(item.weight).toLocaleString()}</td>
            <td>Rp ${Number(item.average).toLocaleString()}</td>
            <td>Rp ${Number(item.value).toLocaleString()}</td>
            <td>${item.soDate}</td>
        </tr>
        `;

                                });
                                document.getElementById("soTable").innerHTML = html;
                                document.getElementById("soTotalValue").innerHTML =
                                "Rp " + grandTotal.toLocaleString("id-ID", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                });
                              
                                document.getElementById("soTotalData").innerHTML =
                                    totalData.toLocaleString();
            
                                soDataLoaded = true;
                            }

                            window.loadSOData = loadSOData;

                            /* ================= PRINT PDF ================= */
                            async function printSOPDF() {
                                if (!soDataLoaded) {
                                    alert("Silakan klik View Data terlebih dahulu.");
                                    return;
                                }

                                const { jsPDF } = window.jspdf;
                                const doc = new jsPDF(
                                    "landscape",
                                    "pt",
                                    "a4"
                                );

                                const month = document.getElementById("filterSOMonth").value;
                                const year = document.getElementById("filterSOYear").value;
                                const q = query(
                                    collection(db, "stock_opname")
                                );

                                const snap = await getDocs(q);
                                let data = [];
                                snap.forEach(d => {

                                    const item = d.data();
                                    const parts = item.soDate.split("-");
                                    const itemYear = parts[0];
                                    const itemMonth = parts[1];

                                    if (year && itemYear !== year) return;
                                    if (month && itemMonth !== month) return;

                                    data.push(item);

                                });

                                // Urutkan berdasarkan Code Material
                                data.sort((a, b) =>
                                    a.code.localeCompare(b.code, undefined, {
                                        numeric: true,
                                        sensitivity: "base"
                                    })
                                );

                                let rows = [];
                                let grandTotal = 0;

                                data.forEach(item => {
                                    grandTotal += Number(item.value || 0);
                                    rows.push([
                                        item.code,
                                        item.name,
                                        item.unit,
                                        Number(item.weight).toLocaleString(),
                                        "Rp " + Number(item.average).toLocaleString(),
                                        "Rp " + Number(item.value).toLocaleString(),
                                        item.soDate
                                    ]);

                                });

                                // ================= HEADER =================
                                const monthNames = ["", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

                                let periode = "ALL DATA";
                                if (month && year) {
                                    periode = `${monthNames[parseInt(month)]} ${year}`;
                                } else if (year) {
                                    periode = year;
                                } else if (month) {
                                    periode = monthNames[parseInt(month)];

                                }

                                doc.setFontSize(16);
                                doc.setFont(undefined, "bold");
                                doc.text(
                                    `LIST STOCK OPNAME - ${periode}`,
                                    40,
                                    40
                                );

                                doc.setFont(undefined, "normal");
                                doc.setFontSize(11);
                                doc.text(
                                    `PERIOD : ${periode}`,
                                    40,
                                    60
                                );

                                doc.text(
                                    `Total Value : Rp ${grandTotal.toLocaleString()}`,
                                    40,
                                    80
                                );

                                const now = new Date();
                                doc.text(
                                    `Print Date : ${now.toLocaleDateString("id-ID")}`,
                                    650,
                                    80
                                );
                                // ================= TABLE =================
                                doc.autoTable({
                                    startY: 100,
                                    head: [[
                                        "Code",
                                        "Material",
                                        "UOM",
                                        "Weight",
                                        "Average Price",
                                        "Value",
                                        "SO Date"
                                    ]],
                                    body: rows,

                                    theme: "grid",

                                    styles: {
                                        fontSize: 9
                                    },

                                    headStyles: {
                                        fillColor: [40, 167, 69],
                                        textColor: [255, 255, 255],
                                        halign: "center"
                                    },

                                    columnStyles: {
                                        0: { halign: "center" },
                                        2: { halign: "center" },
                                        3: { halign: "right" },
                                        4: { halign: "right" },
                                        5: { halign: "right" },
                                        6: { halign: "center" }
                                    }

                                });
                                doc.save(`Stock-Opname-${periode}.pdf`);
                            }
                            window.printSOPDF = printSOPDF;

                            /* =================================================== */
                            /* ============= LOAD STOCK CARD WAREHOUSE =========== */
                            /* =================================================== */
                            async function loadStockCardWarehouse() {

                                try {

                                    // ====================================================
                                    // HELPER FORMAT ANGKA

                                    // ====================================================
                                    function formatNumber(value) {
                                        return Number(value || 0).toLocaleString("id-ID", {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2

                                        });

                                    }

                                    // ====================================================
                                    // GET FILTER
                                    // ====================================================
                                    const month =
                                        document.getElementById("stockCardMonth").value;

                                    const year =
                                        document.getElementById("stockCardYear").value;


                                    // ====================================================
                                    // VALIDASI FILTER
                                    // ====================================================

                                    if (
                                        (month && !year) ||
                                        (!month && year)
                                    ) {

                                        alert("Please select both Month and Year.");

                                        return;
                                    }


                                    // ====================================================
                                    // MODE
                                    // ====================================================
                                    const isFiltered =
                                        !!(month && year);


                                    // ====================================================
                                    // LOAD MASTER MATERIAL
                                    // ====================================================

                                    const materialSnap =
                                        await getDocs(
                                            query(

                                                collection(db, "materials"),
                                                orderBy("code", "asc")
                                            )
                                        );

                                    // ====================================================
                                    // LOAD STOCK CARD
                                    // ====================================================
                                    const stockAwalSnap =
                                        await getDocs(

                                            collection(db, "stock_card")

                                        );

                                    let stockAwalMap = {};
                                    stockAwalSnap.forEach(d => {

                                        const item =
                                            d.data();

                                        const code =
                                            String(
                                                item.code || ""
                                            ).trim();

                                        const weight =
                                            Number(
                                                item.weight || 0
                                            );

                                        if (code) {

                                            stockAwalMap[code] =
                                                (
                                                    stockAwalMap[code] || 0
                                                )
                                                +
                                                weight;

                                        }

                                    });

                                    // ====================================================
                                    // TENTUKAN PERIODE TRANSAKSI
                                    // ====================================================
                                    let transactionStartDate;
                                    let transactionEndDate;
                                    if (isFiltered) {

                                        // =================================================
                                        // FILTERED
                                        // END EXCLUSIVE
                                        // =================================================

                                        transactionStartDate =
                                            `${year}-${month}-01`;

                                        const nextMonthDate =
                                            new Date(

                                                Number(year),
                                                Number(month),
                                                1
                                            );

                                        const nextYear =
                                            nextMonthDate.getFullYear();
                                        const nextMonth =
                                            String(
                                                nextMonthDate.getMonth() + 1
                                            ).padStart(2, "0");
                                        transactionEndDate =
                                            `${nextYear}-${nextMonth}-01`;


                                    } else {

                                        // =================================================
                                        // TANPA FILTER
                                        //
                                        // Semua transaksi
                                        // =================================================
                                        transactionStartDate =
                                            "0001-01-01";
                                        const tomorrow =
                                            new Date();
                                        tomorrow.setDate(
                                            tomorrow.getDate() + 1

                                        );

                                        transactionEndDate =
                                            tomorrow
                                                .toISOString()
                                                .split("T")[0];

                                    }

                                    console.log(
                                        "Stock Card Mode:",
                                        isFiltered
                                            ? "FILTERED"
                                            : "NO FILTER"
                                    );

                                    console.log(
                                        "Transaction Period:",
                                        transactionStartDate,
                                        "until",
                                        transactionEndDate
                                    );

                                    // ====================================================
                                    // LOAD PURCHASE ORDER
                                    // ====================================================
                                    const poQuery =
                                        query(

                                            collection(
                                                db,
                                                "purchasing"
                                            ),

                                            where(
                                                "date",
                                                ">=",
                                                transactionStartDate
                                            ),

                                            where(
                                                "date",
                                                "<",
                                                transactionEndDate
                                            )

                                        );

                                    const poSnap =
                                        await getDocs(
                                            poQuery
                                        );

                                    // ====================================================
                                    // LOAD PRODUKSI
                                    // ====================================================
                                    const produksiQuery =
                                        query(

                                            collection(
                                                db,
                                                "production_orders"
                                            ),

                                            where(
                                                "date",
                                                ">=",
                                                transactionStartDate
                                            ),

                                            where(
                                                "date",
                                                "<",
                                                transactionEndDate
                                            )
                                        );

                                    const produksiSnap =
                                        await getDocs(
                                            produksiQuery
                                        );

                                    // ====================================================
                                    // LOAD PRODUCT RECIPES
                                    // ====================================================
                                    const recipeSnap =
                                        await getDocs(

                                            collection(
                                                db,
                                                "product_recipes"
                                            )
                                        );

                                    // ====================================================
                                    // LOAD PRICE FG
                                    // ====================================================

                                    const priceFgSnap =
                                        await getDocs(

                                            collection(
                                                db,
                                                "price_fg"
                                            )

                                        );


                                    // ====================================================
                                    // LOAD PRODUCTION RESULTS
                                    // ====================================================
                                    const productionResultQuery =
                                        query(

                                            collection(
                                                db,
                                                "production_results"
                                            ),

                                            where(
                                                "date",
                                                ">=",
                                                transactionStartDate
                                            ),

                                            where(
                                                "date",
                                                "<",
                                                transactionEndDate
                                            )

                                        );

                                    const productionResultSnap =
                                        await getDocs(
                                            productionResultQuery
                                        );
                                  
                                    // ====================================================
                                    // LOAD WASTE
                                    // ====================================================
                                    const wasteQuery =
                                        query(

                                            collection(
                                                db,
                                                "waste_material"
                                            ),

                                            where(
                                                "date",
                                                ">=",
                                                transactionStartDate
                                            ),

                                            where(
                                                "date",
                                                "<",
                                                transactionEndDate
                                            )

                                        );

                                    const wasteSnap =
                                        await getDocs(
                                            wasteQuery
                                        );

                                    // ====================================================
                                    // LOAD STOCK OPNAME
                                    // ====================================================
                                    const soSnap =
                                        await getDocs(

                                            collection(
                                                db,
                                                "stock_opname"
                                            )

                                        );


                                    // ====================================================
                                    // MAPPING
                                    // ====================================================
                                    let poMap = {};
                                    let produksiMap = {};
                                    let wasteMap = {};
                                    let lastStockMap = {};
                                    let newSOMap = {};
                                    let allSOMap = {};

                                    // ====================================================
                                    // PURCHASE ORDER
                                    // ====================================================
                                    poSnap.forEach(d => {
                                        const item =
                                            d.data();

                                        const materialCode =
                                            String(
                                                item.materialCode || ""
                                            ).trim();


                                        if (materialCode) {
                                            poMap[materialCode] =
                                                (
                                                    poMap[materialCode] || 0
                                                )
                                                +
                                                Number(
                                                    item.qty || 0
                                                );

                                        }

                                    });

                                    // ====================================================
                                    // PRODUKSI BERDASARKAN RECIPE
                                    // ====================================================
                                    produksiSnap.forEach(
                                        prodDoc => {

                                            const prod =
                                                prodDoc.data();

                                            const productCode =
                                                String(
                                                    prod.productCode || ""
                                                ).trim();


                                            const qtyProduction =
                                                Number(
                                                    prod.qtyProduction || 0
                                                );

                                            recipeSnap.forEach(
                                                recipeDoc => {

                                                    const recipe =
                                                        recipeDoc.data();


                                                    const recipeProductCode =
                                                        String(
                                                            recipe.productCode || ""
                                                        ).trim();

                                                    if (
                                                        recipeProductCode
                                                        ===
                                                        productCode
                                                    ) {

                                                        const materialName =
                                                            String(
                                                                recipe.material || ""
                                                            ).trim();


                                                        const recipeQty =
                                                            Number(
                                                                recipe.qty || 0
                                                            );


                                                        const totalUsage =
                                                            qtyProduction
                                                            *
                                                            recipeQty;


                                                        produksiMap[
                                                            materialName
                                                        ] =
                                                            (
                                                                produksiMap[
                                                                materialName
                                                                ] || 0
                                                            )
                                                            +
                                                            totalUsage;

                                                    }

                                                }
                                            );

                                        }
                                    );

                                    // ====================================================
                                    // PEMAKAIAN BOX DARI HASIL PRODUKSI
                                    // ====================================================
                                    productionResultSnap.forEach(
                                        resultDoc => {

                                            const result =
                                                resultDoc.data();


                                            const productCode =
                                                String(
                                                    result.productCode || ""
                                                ).trim();


                                            const fgBox =
                                                Number(
                                                    result.fgBox || 0
                                                );


                                            priceFgSnap.forEach(
                                                priceDoc => {

                                                    const price =
                                                        priceDoc.data();


                                                    const priceProductCode =
                                                        String(
                                                            price.productCode || ""
                                                        ).trim();


                                                    if (
                                                        priceProductCode
                                                        ===
                                                        productCode
                                                    ) {

                                                        const boxName =
                                                            String(
                                                                price.materialName || ""
                                                            ).trim();


                                                        produksiMap[
                                                            boxName
                                                        ] =
                                                            (
                                                                produksiMap[
                                                                boxName
                                                                ] || 0
                                                            )
                                                            +
                                                            fgBox;

                                                    }

                                                }
                                            );

                                        }
                                    );

                                    // ====================================================
                                    // WASTE MATERIAL
                                    // ====================================================
                                    wasteSnap.forEach(d => {
                                        const item =
                                            d.data();

                                        const materialName =
                                            String(
                                                item.materialName || ""
                                            ).trim();

                                        if (materialName) {
                                            wasteMap[
                                                materialName
                                            ] =
                                                (
                                                    wasteMap[
                                                    materialName
                                                    ] || 0
                                                )
                                                +
                                                Number(
                                                    item.qty || 0
                                                );
                                        }
                                    });

                                    // ====================================================
                                    // STOCK OPNAME
                                    // ====================================================
                                    soSnap.forEach(d => {
                                        const item =
                                            d.data();

                                        const code =
                                            String(
                                                item.code || ""
                                            ).trim();


                                        const soDate =
                                            String(
                                                item.soDate || ""
                                            ).trim();


                                        const weight =
                                            Number(
                                                item.weight || 0
                                            );


                                        if (
                                            !code ||
                                            !soDate
                                        ) {

                                            return;

                                        }

                                        // =================================================
                                        // SO TERAKHIR KESELURUHAN
                                        // =================================================

                                        if (
                                            !allSOMap[code] ||
                                            soDate >
                                            allSOMap[code].date
                                        ) {

                                            allSOMap[code] = {
                                                date: soDate,
                                                weight: weight

                                            };

                                        }

                                        // =================================================
                                        // CARI SO SEBELUM BULAN FILTER
                                        // =================================================
                                        if (isFiltered) {

                                            if (
                                                soDate <
                                                transactionStartDate
                                            ) {

                                                if (
                                                    !lastStockMap[code] ||
                                                    soDate >
                                                    lastStockMap[code].date
                                                ) {

                                                    lastStockMap[code] = {
                                                        date: soDate,
                                                        weight: weight

                                                    };
                                                }
                                            }

                                            // =================================================
                                            // SO DALAM BULAN FILTER
                                            // =================================================

                                            if (
                                                soDate >=
                                                transactionStartDate
                                                &&
                                                soDate <
                                                transactionEndDate
                                            ) {

                                                if (
                                                    !newSOMap[code] ||
                                                    soDate >
                                                    newSOMap[code].date
                                                ) {

                                                    newSOMap[code] = {
                                                        date: soDate,
                                                        weight: weight
                                                    };
                                                }
                                            }
                                        }
                                    });

                                    // ====================================================
                                    // JIKA TIDAK ADA FILTER
                                    //
                                    // LAST STOCK = STOCK CARD AWAL
                                    // ====================================================

                                    if (!isFiltered) {

                                        Object.keys(
                                            stockAwalMap
                                        ).forEach(code => {

                                            lastStockMap[code] = {

                                                date: null,

                                                weight:
                                                    stockAwalMap[code]

                                            };

                                        });

                                    }

                                    // ====================================================
                                    // DEBUG
                                    // ====================================================
                                    console.log(
                                        "Last Stock Map:",
                                        lastStockMap
                                    );

                                    console.log(
                                        "New SO Map:",
                                        newSOMap
                                    );

                                    console.log(
                                        "All SO Map:",
                                        allSOMap
                                    );

                                    // ====================================================
                                    // GENERATE TABLE
                                    // ====================================================
                                    let html = "";
                                    let totalValue = 0;
                                    let totalData = 0;

                                    materialSnap.forEach(d => {
                                        const mat =
                                            d.data();

                                        const code =
                                            String(
                                                mat.code || ""
                                            ).trim();

                                        const name =
                                            String(
                                                mat.name || ""
                                            ).trim();


                                        const average =
                                            Number(
                                                mat.average || 0
                                            );

                                        // =================================================
                                        // LAST STOCK
                                        //
                                        // NO FILTER:
                                        //    dari stock_card
                                        //
                                        // FILTER:
                                        //    dari SO bulan sebelumnya
                                        // =================================================

                                        const qtyStockAwal =
                                            lastStockMap[code]?.weight || 0;

                                        // =================================================
                                        // PO
                                        // =================================================

                                        const qtyPO =
                                            poMap[code] || 0;

                                        // =================================================
                                        // PRODUCTION
                                        // =================================================

                                        const qtyProduksi =
                                            produksiMap[name] || 0;

                                        // =================================================
                                        // WASTE
                                        // =================================================

                                        const qtyWaste =
                                            wasteMap[name] || 0;

                                        // =================================================
                                        // NEW STOCK
                                        // =================================================
                                        const qtyStockAkhir =
                                            qtyStockAwal
                                            + qtyPO
                                            - qtyProduksi
                                            - qtyWaste;

                                        // =================================================
                                        // NEW SO
                                        //
                                        // NO FILTER:
                                        //    SO terakhir keseluruhan
                                        //
                                        // FILTER:
                                        //    SO terakhir pada bulan filter
                                        // =================================================
                                        let qtySOAkhir = 0;
                                        if (isFiltered) {
                                            qtySOAkhir =
                                                newSOMap[code]?.weight || 0;

                                        } else {

                                            qtySOAkhir =
                                                allSOMap[code]?.weight || 0;

                                        }

                                        // =================================================
                                        // DIFFERENCE
                                        // =================================================
                                        const qtySelisih =
                                            qtySOAkhir
                                            -
                                            qtyStockAkhir;

                                        // =================================================
                                        // VALUE
                                        // =================================================
                                        const value =
                                            qtySelisih
                                            *
                                            average;

                                        totalValue += value;
                                        totalData++;

                                        // =================================================
                                        // GENERATE HTML
                                        // =================================================

                                        html += `

                <tr>

                    <td>
                        ${mat.code}
                    </td>
                    <td>
                        ${mat.name}
                    </td>
                    <td>
                        ${mat.unit}
                    </td>
                    <td>
                        ${formatNumber(
                                            qtyStockAwal
                                        )}
                    </td>

                    <td>
                        ${formatNumber(
                                            qtyPO
                                        )}
                    </td>

                    <td>
                        ${formatNumber(
                                            qtyProduksi
                                        )}
                    </td>

                    <td>
                        ${formatNumber(
                                            qtyWaste
                                        )}
                    </td>

                    <td class="text-info fw-bold">
                        ${formatNumber(
                                            qtyStockAkhir
                                        )}
                    </td>

                    <td class="text-warning fw-bold">
                        ${formatNumber(
                                            qtySOAkhir
                                        )}
                    </td>

                    <td class="
                        ${Math.abs(qtySelisih) > 0.000001
                                                ? "text-danger fw-bold"
                                                : "text-success"
                                            }
                    ">
                        ${formatNumber(
                                                qtySelisih
                                            )}
                    </td>

                    <td>
                        Rp ${formatNumber(
                                                value
                                            )}
                    </td>

                </tr>

            `;

                                    });


                                    // ====================================================
                                    // UPDATE TABLE
                                    // ====================================================
                                    document.getElementById(
                                        "stockCardTable"
                                    ).innerHTML =
                                        html;

                                    // ====================================================
                                    // TOTAL VALUE
                                    // ====================================================
                                    document.getElementById(
                                        "stockCardTotalValue"
                                    ).innerHTML =
                                        "Rp " +
                                        formatNumber(
                                            totalValue
                                        );

                                    // ====================================================
                                    // TOTAL DATA
                                    // ====================================================
                                    document.getElementById(
                                        "stockCardTotalData"
                                    ).innerHTML =
                                        totalData.toLocaleString(
                                            "id-ID"
                                        );


                                } catch (err) {
                                    console.error(
                                        "StockCard Error:",
                                        err
                                    );
                                    alert(
                                        "Failed to load Stock Card."
                                    );
                                }
                            }

                            /* =====================================================
                            PRINT PDF STOCK CARD
                            ===================================================== */
                            async function printStockCardPDF() {
                                const {jsPDF} = window.jspdf;
                                const doc =
                                    new jsPDF(
                                        "landscape",
                                        "pt",
                                        "a4"
                                    );


                                // =========================
                                // FILTER MONTH & YEAR
                                // =========================
                                const month =
                                    document.getElementById(
                                        "stockCardMonth"
                                    ).value;

                                const year =
                                    document.getElementById(
                                        "stockCardYear"
                                    ).value;


                                // =========================
                                // GET TABLE DATA
                                // =========================
                                const rows = [];
                                const grandTotal =
                                    document.getElementById(
                                        "stockCardTotalValue"
                                    ).innerText;

                                document.querySelectorAll(
                                    "#stockCardTable tr"
                                ).forEach(tr => {

                                    const cols =
                                        tr.querySelectorAll("td");

                                    if (cols.length > 0) {
                                        rows.push([

                                            cols[0].innerText,
                                            cols[1].innerText,
                                            cols[2].innerText,
                                            cols[3].innerText,
                                            cols[4].innerText,
                                            cols[5].innerText,
                                            cols[6].innerText,
                                            cols[7].innerText,
                                            cols[8].innerText,
                                            cols[9].innerText,
                                            cols[10].innerText
                                        ]);
                                    }
                                });


                                // =========================
                                // HEADER
                                // =========================
                                doc.setFontSize(16);
                                doc.text(
                                    "STOCK CARD BAHAN BAKU WAREHOUSE MADE BALI",
                                    40,
                                    40
                                );

                                doc.setFontSize(11);

                                // =========================
                                // PERIODE
                                // =========================
                                let periodeText = "-";
                                let tahunText = "-";
                                const monthNames = {

                                    "01": "January",
                                    "02": "February",
                                    "03": "March",
                                    "04": "April",
                                    "05": "May",
                                    "06": "June",
                                    "07": "July",
                                    "08": "August",
                                    "09": "September",
                                    "10": "October",
                                    "11": "November",
                                    "12": "December"

                                };

                                if (month && year) {
                                    periodeText =
                                        monthNames[month];
                                    tahunText =
                                        year;
                                }

                                doc.text(
                                    `PERIODE Bulan : ${periodeText}   Tahun : ${tahunText}`,
                                    40,
                                    65
                                );


                                // =========================
                                // PRINT DATE
                                // =========================
                                const now =
                                    new Date();

                                const printDate =
                                    now.toLocaleDateString(
                                        "id-ID"
                                    );

                                doc.text(
                                    `Print Date : ${printDate}`,
                                    650,
                                    65
                                );

                                // =========================
                                // TOTAL VALUE
                                // =========================
                                doc.text(
                                    `Total Value Selisih : ${grandTotal}`,
                                    40,
                                    85
                                );

                                // =========================
                                // TABLE
                                // =========================
                                doc.autoTable({
                                    startY: 110,
                                    head: [[

                                        "Kode",
                                        "Nama Bahan",
                                        "UOM",
                                        "Stock Awal",
                                        "PO",
                                        "Produksi",
                                        "Waste",
                                        "Stock Akhir",
                                        "SO Akhir",
                                        "Selisih",
                                        "Value"

                                    ]],

                                    body: rows,
                                    theme: "grid",
                                    styles: {
                                        fontSize: 8

                                    },
                                    headStyles: {
                                        fillColor: [
                                            40,
                                            40,
                                            40
                                        ]
                                    }
                                });

                                // =========================
                                // SAVE PDF
                                // =========================

                                let fileName = "Stock-Card-Warehouse-Made-Bali";
                                if (month && year) {
                                    fileName += `-${monthNames[month]}-${year}`;
                                }
                                fileName += ".pdf";
                                doc.save(fileName);

                            }

                            window.printStockCardPDF =
                                printStockCardPDF;

                            /* ================= INIT ================= */
                            let appDataInitialized = false;

                            function loadAll() {
                                if (appDataInitialized) return;
                                appDataInitialized = true;

                                // Pastikan dropdown Dashboard sudah terisi sebelum data dibaca,
                                // termasuk bila callback Authentication berjalan lebih dahulu.
                                initDashboard();

                                // Prioritaskan dashboard: selector sudah siap, lalu data KPI/chart dimuat
                                // secara paralel sebelum preload halaman-halaman lain.
                                refreshDashboard();

                                // Pastikan filter Purchasing siap sebelum tabel dimuat.
                                initPurchaseFilter();

                                loadUnits();
                                loadSuppliers();
                                loadMaterials();
                                loadPurchases();
                                loadPurchasesData();
                                loadPurchaseOptions();
                                loadProductionProducts();
                                loadProductionListData();
                                loadForecast();
                                loadStores();
                                setStoreCode();
                                initSalesFGFilter();
                                loadSalesFGStores();
                                loadSalesFGTable();
                                loadSalesTable();
                                loadStockCardWarehouse();
                                loadStockAwalTable();
                            }

                            window.addEventListener("DOMContentLoaded", () => {
                                // Isi pilihan bulan/tahun segera, tanpa menunggu data Firestore.
                                initDashboard();
                            });

                            /* ================= GLOBAL EXPORT ================= */
                            window.login = login;
                            window.logout = logout;
                            window.toggleMaster = toggleMaster;
                            window.showMaster = showMaster;
                            window.showSupplier = showSupplier;
                            window.showPage = showPage;

                            window.addUnit = addUnit;
                            window.addSupplier = addSupplier;
                            window.addMaterial = addMaterial;

                            window.loadUnits = loadUnits;
                            window.loadSuppliers = loadSuppliers;
                            window.loadMaterials = loadMaterials;
                            window.deleteProduction = deleteProduction;

                            window.deleteUnit = deleteUnit;
                            window.deleteSupplier = deleteSupplier;
                            window.deleteMaterial = deleteMaterial;

                            window.showProductionRecipe = showProductionRecipe;
                            window.addRecipeItem = addRecipeItem;
                            window.saveRecipe = saveRecipe;
                            window.deleteRecipeItem = deleteRecipeItem;
                            window.viewForecast = viewForecast;
                            window.backForecast = backForecast;
                            window.calculateAverage = calculateAverage;
                            window.togglePurchasing = togglePurchasing;
                            window.savePurchase = savePurchase;
                            window.deletePurchase = deletePurchase;
                            window.printPurchasePDF = printPurchasePDF;
                            window.loadPurchases = loadPurchases;
                            window.loadPurchasesData = loadPurchasesData;
                            window.loadPurchaseOptions = loadPurchaseOptions;

                            window.toggleProduksi = toggleProduksi;
                            window.showProduksi = showProduksi;
                            window.saveProduction = saveProduction;
                            window.loadProductionListData = loadProductionListData;
                            window.viewProductionDetail = viewProductionDetail;
                            window.loadProductionProducts = loadProductionProducts;
                            window.backProduction = backProduction;
                            window.clearProductionFilter = clearProductionFilter;

                            window.loadProductionOrdersToResultSelect = loadProductionOrdersToResultSelect;
                            window.saveProductionResult = saveProductionResult;
                            window.loadProductionResult = loadProductionResult;
                            window.deleteProductionResult = deleteProductionResult;

                            window.toggleMarketing = toggleMarketing;
                            window.saveStore = saveStore;
                            window.openMarketingSales = openMarketingSales;
                            window.saveSales = saveSales;
                            window.loadSalesFGTable = loadSalesFGTable;
                            window.loadSalesReport = loadSalesReport;
                            window.deleteStore = deleteStore;
                            window.deleteSales = deleteSales;
                            window.loadSalesTable = loadSalesTable;
                            window.exportSalesPDF = exportSalesPDF;

                            window.openWasteFGPage = openWasteFGPage;
                            window.saveWasteFG = saveWasteFG;
                            window.deleteWasteFG = deleteWasteFG;
                            window.loadWasteFGTable = loadWasteFGTable;

                            window.openWasteMaterialPage = openWasteMaterialPage;
                            window.calculateWasteMaterialPrice = calculateWasteMaterialPrice;
                            window.saveWasteMaterial = saveWasteMaterial;
                            window.loadWasteMaterialTable = loadWasteMaterialTable;
                            window.deleteWasteMaterial = deleteWasteMaterial;

                            window.showPriceProduct = showPriceProduct;
                            window.savePriceFG = savePriceFG;
                            window.loadPriceFGTable = loadPriceFGTable;
                            window.deletePriceFG = deletePriceFG;

                            window.loadPriceFGMaterials = loadPriceFGMaterials;
                            window.calculatePriceFG = calculatePriceFG;

                            window.openSalesFGPage = openSalesFGPage;
                            window.addSalesFGRow = addSalesFGRow;
                            window.saveSalesFG = saveSalesFG;
                            window.deleteSalesFG = deleteSalesFG;
                            window.setSalesFGPrice = setSalesFGPrice;
                            window.calculateSalesFGTotal = calculateSalesFGTotal;
                            window.removeSalesFGRow = removeSalesFGRow;

                            window.openProductionCost = openProductionCost;
                            window.saveProductionCost = saveProductionCost;
                            window.loadProductionCostReport = loadProductionCostReport;
                            window.deleteProductionCost = deleteProductionCost;
                            
                            window.toggleAccounting = toggleAccounting;
                            window.openReport = openReport;
                            window.loadPurchasingReport = loadPurchasingReport;
                            window.backToReportMenu = backToReportMenu;
                            window.loadSelectedReport = loadSelectedReport;
                            window.loadProductionReport = loadProductionReport;
                            window.loadCOGSReport = loadCOGSReport;
                            window.loadProfitLossReport = loadProfitLossReport;

                            window.toggleGudang = toggleGudang;
                            window.readSOExcel = readSOExcel;
                            window.saveSOData = saveSOData;
                            window.loadSOData = loadSOData;
                            window.printSOPDF = printSOPDF;
                            window.loadStockCardWarehouse = loadStockCardWarehouse;

                            // ==========================
                            // FUNCITON OPEN PAGE ALL
                            // ==========================
                            function showPage(pageId) {
                                document.querySelectorAll(".menu-page").forEach(page => {
                                    page.style.display = "none";
                                });

                                const activePage = document.getElementById(pageId);
                                if (!activePage) {
                                    console.error("Page tidak ditemukan:", pageId);
                                    return;
                                }
                                activePage.style.display = "block";
                                if (pageId === "dashboard") {
                                    refreshDashboard();
                                }
                            }
                            // ==========================
                            // GLOBAL CHART VARIABLES
                            // ==========================
                            let salesChart = null;
                            let productionChart = null;
                            let variantChart = null;
                            let storeChart = null;
                            let dashboardTotalSales = 0;
                            let dashboardTotalProductionCost = 0;

                            //=============================
                            // LOAD FILTER BULAN & TAHUN
                            //=============================
                            let dashboardFiltersInitialized = false;

                            function initDashboard() {
                                const month = document.getElementById("dashMonth");
                                const year = document.getElementById("dashYear");

                                // Jangan hentikan seluruh inisialisasi aplikasi bila halaman Dashboard
                                // belum tersedia atau fungsi dipanggil lebih dari satu kali.
                                if (!month || !year) {
                                    console.warn("Filter Dashboard tidak ditemukan.");
                                    return;
                                }
                                if (dashboardFiltersInitialized) return;
                                dashboardFiltersInitialized = true;

                                month.innerHTML = "";
                                year.innerHTML = "";
                                const monthName = [
                                    "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
                                monthName.forEach((m, i) => {

                                    month.innerHTML += `
                                  <option value="${i + 1}">
                                      ${m}
                                  </option>
                              `;
                                                      });
                                                      const now = new Date();
                                                      for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 2; y++) {
                                                          year.innerHTML += `
                                  <option value="${y}">
                                      ${y}
                                  </option>
                              `;
                                 }
                                month.value = now.getMonth() + 1;
                                year.value = now.getFullYear();

                                const handleDashboardFilterChange = () => {
                                    if (!month.value || !year.value) return;
                                    refreshDashboard();
                                };
                                month.addEventListener("change", handleDashboardFilterChange);
                                year.addEventListener("change", handleDashboardFilterChange);
                                // Data dashboard dimuat setelah login berhasil.
                            }
                            //=============================
                            // Snapshot cache khusus satu siklus refresh dashboard.
                            // Menghindari pembacaan koleksi yang sama berulang kali untuk KPI dan grafik.
                            let dashboardSnapshotCache = Object.create(null);

                            function getDashboardSnapshot(collectionName) {
                                if (!dashboardSnapshotCache[collectionName]) {
                                    dashboardSnapshotCache[collectionName] =
                                        getDocs(collection(db, collectionName));
                                }
                                return dashboardSnapshotCache[collectionName];
                            }

                            // LOAD DASHBOARD SALES
                            //=============================
                            async function loadDashboardSales() {
                                const month = Number(document.getElementById("dashMonth").value);
                                const year = Number(document.getElementById("dashYear").value);
                                const snap = await getDashboardSnapshot("sales");
                                let totalSales = 0;
                                let monthlySales = Array(12).fill(0);
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    if (!d.date) return;
                                    const dt = new Date(d.date);
                                    const y = dt.getFullYear();
                                    const m = dt.getMonth() + 1;
                                    // Chart tahunan
                                    if (y === year) {
                                        monthlySales[m - 1] += Number(d.value || 0);
                                    }

                                    // KPI bulan berjalan
                                    if (y === year && m === month) {
                                        totalSales += Number(d.value || 0);
                                    }

                                });

                                document.getElementById("dashTotalSales").innerHTML =
                                    "Rp " + totalSales.toLocaleString("id-ID");

                                dashboardTotalSales = totalSales;

                                document.getElementById("dashTotalSales").innerHTML =
                                    "Rp " + totalSales.toLocaleString("id-ID");

                                const ctx = document.getElementById("salesChart");
                                if (salesChart != null) {
                                    salesChart.destroy();
                                }

                                salesChart = new Chart(ctx, {
                                    type: "line",
                                    data: {
                                        labels: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
                                        datasets: [{
                                            label: "Sales",
                                            data: monthlySales,
                                            borderColor: "#facc15",
                                            backgroundColor: "rgba(250,204,21,0.2)",
                                            fill: true,
                                            tension: 0.4,
                                            pointRadius: 3
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        plugins: {
                                            legend: { display: true }
                                        }
                                    }
                                });
                            }

                            //=============================
                            // LOAD DASHBOARD PRODUCTION
                            //=============================
                            async function loadDashboardProduction() {
                                const month = parseInt(document.getElementById("dashMonth").value);
                                const year = parseInt(document.getElementById("dashYear").value);
                                const snap = await getDashboardSnapshot("production_results");
                                let totalFG = 0;
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    if (!d.date) return;
                                    // Format YYYY-MM-DD
                                    const arr = d.date.split("-");
                                    const itemYear = Number(arr[0]);
                                    const itemMonth = Number(arr[1]);
                                    if (itemYear === year && itemMonth === month) {
                                        totalFG += Number(d.fgPcs || 0);
                                    }
                                });

                                document.getElementById("dashTotalProduction").innerHTML =
                                    totalFG.toLocaleString("id-ID") + " Pcs";

                            }
                            async function loadProductionChart() {
                                const year = Number(document.getElementById("dashYear").value);
                                const snap = await getDashboardSnapshot("production_results");
                                let monthlyFG = Array(12).fill(0);
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    if (!d.date) return;
                                    const dt = new Date(d.date);
                                    if (dt.getFullYear() === year) {
                                        monthlyFG[dt.getMonth()] += Number(d.fgPcs || 0);
                                    }
                                });

                                const ctx = document.getElementById("productionChart");
                                if (productionChart) {
                                    productionChart.destroy();
                                }
                                productionChart = new Chart(ctx, {
                                    type: "bar",
                                    data: {
                                        labels: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
                                        datasets: [{
                                            label: "FG Production",
                                            data: monthlyFG,
                                            backgroundColor: "#facc15",
                                            borderRadius: 6
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        plugins: {
                                            legend: { display: true }
                                        }
                                    }
                                });
                            }
                            //=============================
                            // LOAD DASHBOARD COST PRODUCTION
                            //=============================
                            async function loadDashboardCostProduction() {

                                const month = Number(document.getElementById("dashMonth").value);
                                const year = Number(document.getElementById("dashYear").value);
                                const prodSnap = await getDashboardSnapshot("production_results");
                                const recipeSnap = await getDashboardSnapshot("product_recipes");
                                const materialSnap = await getDashboardSnapshot("materials");
                                const costSnap = await getDashboardSnapshot("production_cost");

                                let fgMap = {};
                                let totalCOGS = 0;
                                let totalOverhead = 0;

                                // ===============================
                                // HITUNG TOTAL FG PER PRODUCT
                                // ===============================
                                prodSnap.forEach(doc => {
                                    const prod = doc.data();
                                    if (!prod.date) return;
                                    const dt = new Date(prod.date);
                                    if (
                                        dt.getFullYear() === year &&
                                        (dt.getMonth() + 1) === month
                                    ) {

                                        if (!fgMap[prod.productCode]) {
                                            fgMap[prod.productCode] = {
                                                qty: 0
                                            };
                                        }
                                        fgMap[prod.productCode].qty += Number(prod.fgPcs || 0);
                                    }
                                });

                                // ===============================
                                // HITUNG HPP
                                // ===============================
                                for (const productCode in fgMap) {
                                    const recipes = recipeSnap.docs
                                        .map(doc => doc.data())
                                        .filter(r => r.productCode === productCode);
                                    for (const recipe of recipes) {
                                        const material = materialSnap.docs
                                            .map(doc => doc.data())
                                            .find(m =>
                                                m.name.trim().toLowerCase() ===
                                                recipe.material.trim().toLowerCase()
                                            );

                                        if (!material) continue;
                                        const usedQty =
                                            Number(recipe.qty || 0) *
                                            Number(fgMap[productCode].qty);

                                        totalCOGS +=
                                            usedQty *
                                            Number(material.average || 0);
                                    }
                                }

                                // ===============================
                                // HITUNG OVERHEAD
                                // ===============================
                                costSnap.forEach(doc => {
                                    const cost = doc.data();
                                    if (!cost.date) return;
                                    const dt = new Date(cost.date);
                                    if (
                                        dt.getFullYear() === year &&
                                        (dt.getMonth() + 1) === month
                                    ) {

                                        totalOverhead += Number(cost.value || 0);
                                    }
                                });

                                // ===============================
                                // TOTAL COST PRODUCTION
                                // ===============================
                                dashboardTotalProductionCost = totalCOGS + totalOverhead;

                                document.getElementById("dashTotalCostProduction").innerHTML =
                                    "Rp " + dashboardTotalProductionCost.toLocaleString("id-ID", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    });
                            }
                            //=============================
                            // LOAD DASHBOARD NET PROFIT
                            //=============================
                            function loadDashboardNetProfit() {
                                const nett =
                                    dashboardTotalSales -
                                    dashboardTotalProductionCost;
                                document.getElementById("dashNettProfit").innerHTML =
                                    "Rp " + nett.toLocaleString("id-ID", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    });
                            }

                            //=============================
                            // BEST SELLING PRODUCT
                            //=============================
                            async function loadVariantChart() {
                                const month = Number(document.getElementById("dashMonth").value);
                                const year = Number(document.getElementById("dashYear").value);
                                const snap = await getDashboardSnapshot("sales_fg");
                                let productMap = {};
                                snap.forEach(doc => {
                                    const d = doc.data();
                                    if (!d.date) return;
                                    const arr = d.date.split("-");
                                    const itemYear = Number(arr[0]);
                                    const itemMonth = Number(arr[1]);

                                    if (
                                        itemYear === year &&
                                        itemMonth === month
                                    ) {

                                        if (!productMap[d.productCode]) {

                                            productMap[d.productCode] = {
                                                name: d.productName,
                                                qty: 0
                                            };
                                        }
                                        productMap[d.productCode].qty += Number(d.qtyPcs || 0);
                                    }
                                });

                                // Urutkan qty terbesar
                                const ranking = Object.values(productMap)
                                    .sort((a, b) => b.qty - a.qty)
                                    .slice(0, 10);

                                const labels = ranking.map(x => x.name);
                                const data = ranking.map(x => x.qty);
                                const ctx = document.getElementById("variantChart");
                                if (variantChart) {
                                    variantChart.destroy();
                                }
                                variantChart = new Chart(ctx, {
                                    type: "doughnut",
                                    data: {
                                        labels: labels,
                                        datasets: [{
                                            data: data,
                                            backgroundColor: [
                                                "#facc15",
                                                "#fbbf24",
                                                "#f59e0b",
                                                "#eab308",
                                                "#ca8a04"
                                            ],
                                            borderWidth: 1
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        cutout: "60%",
                                        plugins: {
                                            legend: {
                                                display: true
                                            }
                                        }
                                    }
                                });
                            }

                            //=============================
                            // BEST SALES STORE CHART
                            //=============================
                            async function loadStoreChart() {
                                const month = Number(document.getElementById("dashMonth").value);
                                const year = Number(document.getElementById("dashYear").value);
                                const snap = await getDashboardSnapshot("sales");

                                let storeMap = {};
                                snap.forEach(doc => {
                                    const d = doc.data();

                                    if (!d.date) return;
                                    const dt = new Date(d.date);
                                    const m = dt.getMonth() + 1;
                                    const y = dt.getFullYear();

                                    if (m !== month || y !== year) return;
                                    const key = d.storeName || d.storeCode;

                                    if (!storeMap[key]) {
                                        storeMap[key] = {
                                            name: key,
                                            total: 0
                                        };
                                    }

                                    storeMap[key].total += Number(d.value || 0);
                                });

                                // convert + sort top store
                                const ranking = Object.values(storeMap)
                                    .sort((a, b) => b.total - a.total)
                                    .slice(0, 10);

                                const labels = ranking.map(x => x.name);
                                const data = ranking.map(x => x.total);

                                const ctx = document.getElementById("storeChart");

                                if (storeChart) {
                                    storeChart.destroy();
                                }

                                storeChart = new Chart(ctx, {
                                    type: "pie",   // WAJIB pie
                                    data: {
                                        labels: labels,
                                        datasets: [{
                                            data: data,
                                            backgroundColor: [
                                                "#facc15",
                                                "#fbbf24",
                                                "#f59e0b",
                                                "#eab308",
                                                "#ca8a04",
                                                "#d97706"
                                            ]
                                        }]
                                    },
                                    options: {
                                        responsive: true,
                                        cutout: 0,   // 🔥 INI PENTING: pastikan bukan doughnut
                                        plugins: {
                                            legend: { display: true },
                                            tooltip: {
                                                callbacks: {
                                                    label: function (context) {
                                                        return context.label + " : Rp " +
                                                            context.raw.toLocaleString("id-ID");
                                                    }
                                                }
                                            }
                                        }
                                    }
                                });
                            }

                            async function refreshDashboard() {
                                // Ambil seluruh koleksi yang diperlukan secara paralel.
                                // Hasilnya dipakai bersama oleh KPI dan grafik agar tidak fetch berulang.
                                dashboardSnapshotCache = Object.create(null);

                                try {
                                    await Promise.all([
                                        "sales",
                                        "production_results",
                                        "product_recipes",
                                        "materials",
                                        "production_cost",
                                        "sales_fg"
                                    ].map(name => getDashboardSnapshot(name)));

                                    await Promise.all([
                                        loadDashboardSales(),
                                        loadDashboardProduction(),
                                        loadDashboardCostProduction(),
                                        loadProductionChart(),
                                        loadVariantChart(),
                                        loadStoreChart()
                                    ]);

                                    loadDashboardNetProfit();
                                } catch (error) {
                                    console.error("Gagal memuat dashboard:", error);
                                }
                            }
                            // ==========================
                            // DATE TIME
                            // ==========================
                            function updateDateTime() {
                                const now = new Date();
                                const hariList = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
                                const hari = hariList[now.getDay()];
                                const tanggal = now.toLocaleDateString('id-ID', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                });

                                const jam = now.toLocaleTimeString('id-ID');
                                document.getElementById("hari").innerText = hari;
                                document.getElementById("tanggal").innerText = tanggal;
                                document.getElementById("jam").innerText = jam;
                            }
                            setInterval(updateDateTime, 1000);
                            updateDateTime();
