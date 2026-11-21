cmake_minimum_required(VERSION 3.20)
project(AssistedRegistration VERSION 1.2.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Qt5 5.15 REQUIRED COMPONENTS Core Gui Widgets Network)
find_package(CURL REQUIRED)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/bin")
foreach(config Debug Release RelWithDebInfo MinSizeRel)
  string(TOUPPER "${config}" config_upper)
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${config_upper} "${CMAKE_SOURCE_DIR}/bin")
endforeach()
file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/generated")
add_custom_command(OUTPUT "${CMAKE_BINARY_DIR}/generated/main.moc"
  COMMAND Qt5::moc "${CMAKE_SOURCE_DIR}/src/main.cpp" -o "${CMAKE_BINARY_DIR}/generated/main.moc"
  DEPENDS src/main.cpp VERBATIM)
add_custom_target(application_moc DEPENDS "${CMAKE_BINARY_DIR}/generated/main.moc")
function(configure_application target)
  target_include_directories(${target} PRIVATE src "${CMAKE_BINARY_DIR}/generated")
  target_link_libraries(${target} PRIVATE Qt5::Core Qt5::Gui Qt5::Widgets Qt5::Network CURL::libcurl)
  if(WIN32)
    target_link_libraries(${target} PRIVATE ws2_32)
  endif()
  target_compile_definitions(${target} PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
  if(MSVC)
    target_compile_options(${target} PRIVATE /utf-8)
  endif()
endfunction()
add_executable(AssistedRegistration WIN32 src/main.cpp src/native_backend.cpp src/native_service.cpp src/booking_service.cpp)
add_dependencies(AssistedRegistration application_moc)
configure_application(AssistedRegistration)
include(CTest)
if(BUILD_TESTING)
  # Fixtures that compile the real Window from src/main.cpp and need generated/main.moc.
  function(add_window_fixture target source)
    add_executable(${target} ${source} tests/offline_broker_guard.cpp src/native_service.cpp src/booking_service.cpp)
    add_dependencies(${target} application_moc)
    configure_application(${target})
    if(ARGN)
      target_compile_definitions(${target} PRIVATE ${ARGN})
    endif()
  endfunction()

  # Plain Core-only fixtures (no Window, no moc).
  function(add_core_fixture target source)
    add_executable(${target} ${source})
    configure_application(${target})
  endfunction()

  add_window_fixture(preview_probe tests/preview_probe.cpp)
  add_window_fixture(booking_ui_offline_test tests/booking_ui_offline_test.cpp)
  add_window_fixture(pool_recovery_offline_test tests/pool_recovery_offline_test.cpp HAS_QUERY_POOL HAS_DYNAMIC_POOL)
  add_window_fixture(parallel_query_offline_test tests/parallel_query_offline_test.cpp HAS_QUERY_POOL HAS_DYNAMIC_POOL)
  add_window_fixture(smooth_refresh_offline_test tests/smooth_refresh_offline_test.cpp SMOOTH_CANDIDATE)

  # These fixtures ship their own Broker substitute and only need the real Service.
  foreach(target legacy_service_offline_test legacy_query_offline_test)
    add_executable(${target} tests/${target}.cpp src/native_service.cpp)
    configure_application(${target})
  endforeach()

  add_executable(backend_booking_offline_probe tests/backend_booking_offline_probe.cpp)
  configure_application(backend_booking_offline_probe)

  add_core_fixture(dns_cache_offline_test tests/dns_cache_offline_test.cpp)
  add_core_fixture(legacy_departments_offline_test tests/legacy_departments_offline_test.cpp)
  add_core_fixture(legacy_parser_offline_test tests/legacy_parser_offline_test.cpp)
  add_core_fixture(session_store_offline_test tests/session_store_offline_test.cpp)

  if(WIN32)
    set(TEST_QT_PLATFORM "QT_QPA_PLATFORM=windows")
  else()
    # macOS / Linux have no "windows" QPA plugin; offscreen renders offscreen
    # widgets and still supports QWidget::grab() used by the screenshot fixtures.
    set(TEST_QT_PLATFORM "QT_QPA_PLATFORM=offscreen")
  endif()

  add_test(NAME booking_service_offline COMMAND AssistedRegistration --booking-self-test --output "${CMAKE_BINARY_DIR}/booking-tests.json")
  add_test(NAME query_service_offline COMMAND AssistedRegistration --self-test --output "${CMAKE_BINARY_DIR}/query-tests.json")
  add_test(NAME backend_offline COMMAND backend_booking_offline_probe "${PROJECT_SOURCE_DIR}")
  add_test(NAME booking_ui_offline COMMAND booking_ui_offline_test "${PROJECT_SOURCE_DIR}")
  add_test(NAME preview_probe_offline COMMAND preview_probe "${PROJECT_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/preview-result.json")
  add_test(NAME pool_recovery_offline COMMAND pool_recovery_offline_test "${PROJECT_SOURCE_DIR}")
  add_test(NAME parallel_query_offline COMMAND parallel_query_offline_test "${PROJECT_SOURCE_DIR}")
  add_test(NAME smooth_refresh_offline COMMAND smooth_refresh_offline_test "${PROJECT_SOURCE_DIR}")
  add_test(NAME session_store_offline COMMAND session_store_offline_test)
  add_test(NAME dns_cache_offline COMMAND dns_cache_offline_test)
  add_test(NAME legacy_parser_offline COMMAND legacy_parser_offline_test)
  add_test(NAME legacy_departments_offline COMMAND legacy_departments_offline_test "${PROJECT_SOURCE_DIR}/tests/fixtures/legacy_departments_public.json")
  add_test(NAME legacy_service_offline COMMAND legacy_service_offline_test "${PROJECT_SOURCE_DIR}")
  add_test(NAME legacy_query_offline COMMAND legacy_query_offline_test "${PROJECT_SOURCE_DIR}")

  set_tests_properties(
    booking_service_offline query_service_offline backend_offline
    booking_ui_offline preview_probe_offline pool_recovery_offline
    parallel_query_offline smooth_refresh_offline session_store_offline
    dns_cache_offline legacy_parser_offline legacy_departments_offline
    legacy_service_offline legacy_query_offline
    PROPERTIES ENVIRONMENT "${TEST_QT_PLATFORM}" WORKING_DIRECTORY "${CMAKE_BINARY_DIR}" TIMEOUT 180)

  # Scheduling matrix described in tests/LATEST_OFFLINE_TESTS.md.
  foreach(connections 1 2 4 16)
    foreach(mode detail empty mixed fastdetail)
      set(name "parallel_query_offline_c${connections}_${mode}")
      add_test(NAME ${name} COMMAND parallel_query_offline_test "${PROJECT_SOURCE_DIR}")
      set_tests_properties(${name} PROPERTIES
        ENVIRONMENT "${TEST_QT_PLATFORM};PROBE_CONNECTIONS=${connections};PROBE_MODE=${mode}"
        WORKING_DIRECTORY "${CMAKE_BINARY_DIR}" TIMEOUT 180)
    endforeach()
  endforeach()
endif()
