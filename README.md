# NVGT Language Server for VSCode

NVGT can be found [here](https://github.com/samtupy/nvgt) and is based off of Angelscript

# Getting Started

As of right now, no version has been published on the marketplace as there are plans to provide a more useful system of type hints and completion. If you wish to run this, launch the debugger with the client configuration from within VSCode.

# TODO

As this is a fork of [Angel LSP](https://github.com/sashi0034/angel-lsp/), we currently share all of the features that are marked as todo on there. If anything changes, this section will be updated.

# What about as.predefined?

Since this is specifically aimed at NVGT, the support for placing as.predefined in the current directory of your project has been removed. Instead, the extension comes with the standard library definitions in the `resources` folder of the server. It should get copied into the out folder during builds and is loaded on startup.

It should be noted that the extension is not always up-to-date with the main branch of NVGT. The process for updating the definition file still requires human intervention.

# Issues and Contributions

Feel free to contribute or to open an issue if you find a bug, as much of this is untested. Please include enough detail so that your issue can be reliably reproduced.
