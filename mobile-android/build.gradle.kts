plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

// Versions pinned for reproducibility; update deliberately.
extra["compileSdk"] = 35
extra["minSdk"] = 26
extra["targetSdk"] = 35
