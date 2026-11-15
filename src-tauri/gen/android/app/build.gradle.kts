import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Assinatura da versão publicada: de `keystore.properties` (fora do repositório) ou das
// variáveis de ambiente do CI (segredos do GitHub). Sem elas, a versão final é assinada com a
// chave de depuração — instala-se, mas não serve para publicar (e não atualiza uma instalada
// com a chave verdadeira).
val assinatura = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun valorAssinatura(chave: String, variavel: String): String? =
    (assinatura.getProperty(chave) ?: System.getenv(variavel))?.takeIf { it.isNotBlank() }
val ficheiroChave = valorAssinatura("storeFile", "LISSECURITY_KEYSTORE")

// Só para o teste ponta-a-ponta no emulador: deixa o teste ligar-se à WebView (DevTools).
// Nunca ligado nas compilações publicadas.
val depurarWebView = (project.findProperty("depurarWebView") as String?) == "true"

android {
    compileSdk = 36
    namespace = "pt.lisfilms.lissecurity"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "pt.lisfilms.lissecurity"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
        buildConfigField("boolean", "DEPURAR_WEBVIEW", depurarWebView.toString())
    }
    signingConfigs {
        create("lancamento") {
            if (ficheiroChave != null) {
                storeFile = file(ficheiroChave)
                storePassword = valorAssinatura("storePassword", "LISSECURITY_KEYSTORE_SENHA")
                keyAlias = valorAssinatura("keyAlias", "LISSECURITY_CHAVE_ALIAS")
                keyPassword = valorAssinatura("keyPassword", "LISSECURITY_CHAVE_SENHA")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = if (ficheiroChave != null) signingConfigs.getByName("lancamento") else signingConfigs.getByName("debug")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // desbloqueio com impressão digital ou rosto (BiometricPrompt + Android Keystore)
    implementation("androidx.biometric:biometric:1.1.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
