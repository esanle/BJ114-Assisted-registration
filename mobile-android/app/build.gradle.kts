plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hospitalbooking.assisted"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hospitalbooking.assisted"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.2.0-mobile"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // JS engine for the anti-bot DOM sandbox. Rhino is pure-Java and works on Android;
    // it is NOT V8, so V8-intrinsic-dependent helpers need adaptation (see js/README).
    implementation("org.mozilla:rhino:1.7.14")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
