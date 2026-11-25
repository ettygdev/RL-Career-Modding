"""Set the Windows launcher icon while preserving the embedded Node application."""
import ctypes as c
from ctypes import wintypes as w
from pathlib import Path
import struct
import sys


def install(executable, icon):
    api = c.WinDLL("kernel32", use_last_error=True)
    api.BeginUpdateResourceW.argtypes = (w.LPCWSTR, w.BOOL)
    api.BeginUpdateResourceW.restype = w.HANDLE
    api.UpdateResourceW.argtypes = (w.HANDLE, c.c_void_p, c.c_void_p, w.WORD, c.c_void_p, w.DWORD)
    api.UpdateResourceW.restype = w.BOOL
    api.EndUpdateResourceW.argtypes = (w.HANDLE, w.BOOL)
    api.EndUpdateResourceW.restype = w.BOOL
    api.LoadLibraryExW.argtypes = (w.LPCWSTR, w.HANDLE, w.DWORD)
    api.LoadLibraryExW.restype = w.HANDLE
    api.FreeLibrary.argtypes = (w.HANDLE,)
    callback_type = c.WINFUNCTYPE(w.BOOL, w.HANDLE, c.c_void_p, c.c_void_p, w.LPARAM)
    api.EnumResourceNamesW.argtypes = (w.HANDLE, c.c_void_p, callback_type, w.LPARAM)

    data = icon.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data)
    if (reserved, kind, count) != (0, 1, 1):
        raise ValueError("Expected one launcher icon")
    width, height, colors, _, planes, depth, length, offset = struct.unpack_from("<BBBBHHII", data, 6)
    bitmap = data[offset:offset + length]
    if not length or len(bitmap) != length:
        raise ValueError("Invalid launcher icon data")

    group_names = []

    @callback_type
    def collect(_module, _kind, name, _param):
        if name and name <= 65535:
            group_names.append(name)
        return True

    module = api.LoadLibraryExW(str(executable), None, 2)
    if not module:
        raise c.WinError(c.get_last_error())
    try:
        api.EnumResourceNamesW(module, 14, collect, 0)
    finally:
        api.FreeLibrary(module)

    handle = api.BeginUpdateResourceW(str(executable), False)
    if not handle:
        raise c.WinError(c.get_last_error())
    image_id = 8190
    group = struct.pack("<HHHBBBBHHIH", 0, 1, 1, width, height, colors, 0, planes, depth, length, image_id)
    completed = False
    try:
        if not api.UpdateResourceW(handle, 3, image_id, 1033, bitmap, len(bitmap)):
            raise c.WinError(c.get_last_error())
        for group_id in group_names or [1]:
            if not api.UpdateResourceW(handle, 14, group_id, 1033, group, len(group)):
                raise c.WinError(c.get_last_error())
        completed = True
    finally:
        if not api.EndUpdateResourceW(handle, not completed):
            raise c.WinError(c.get_last_error())


if __name__ == "__main__":
    install(Path(sys.argv[1]).resolve(), Path(sys.argv[2]))
